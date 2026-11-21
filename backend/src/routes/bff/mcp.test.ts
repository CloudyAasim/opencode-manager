import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createBffRoutes } from './index'
import { ProviderRegistry } from '../../providers/registry'
import { ResourceNotFoundError } from '../../providers/contract'
import type { AuthInstance } from '../../auth'
import { FakeAgentProvider } from '../../../test/helpers/fake-agent-provider'
import { migrate } from '../../db/migration-runner'
import { allMigrations } from '../../db/migrations'
import type { McpServer } from '@opencode-manager/shared/api/v1'

function authThatFinds(session: unknown): AuthInstance {
  return {
    api: { getSession: async () => session },
  } as unknown as AuthInstance
}

const asAdmin = authThatFinds({
  session: { id: 'session-1', userId: 'user-1' },
  user: {
    id: 'user-1',
    name: 'user',
    username: 'user-1',
    email: 'user@example.com',
    role: 'admin',
  },
})
const asSomebodyElse = authThatFinds({
  session: { id: 'session-2', userId: 'user-2' },
  user: {
    id: 'user-2',
    name: 'other',
    username: 'user-2',
    email: 'other@example.com',
    role: 'user',
  },
})

let database: Database
let workspace: string
let previousWorkspacePath: string | undefined

/** The working directory that belongs to the person calling. */
function ownDirectory(): string {
  return path.join(workspace, 'users', 'user-2', 'workspace')
}

/** The working directory that belongs to somebody else. */
function otherDirectory(): string {
  return path.join(workspace, 'users', 'user-1', 'workspace')
}

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'bff-mcp-'))
  previousWorkspacePath = process.env.WORKSPACE_PATH
  process.env.WORKSPACE_PATH = workspace
  database = new Database(':memory:')
  migrate(database, allMigrations)
})

afterAll(async () => {
  database.close()
  if (previousWorkspacePath === undefined) {
    delete process.env.WORKSPACE_PATH
  } else {
    process.env.WORKSPACE_PATH = previousWorkspacePath
  }
  await rm(workspace, { recursive: true, force: true })
})

function createApp(
  providers: FakeAgentProvider[],
  auth: AuthInstance = asAdmin,
): { app: Hono; registry: ProviderRegistry } {
  const registry = new ProviderRegistry()
  for (const provider of providers) registry.register(provider, { default: true })
  const app = new Hono()
  app.route('/api/bff', createBffRoutes(registry, database, { auth }))
  return { app, registry }
}

function json(res: Response): Promise<{
  error?: { code: string; message?: string; details?: unknown }
  servers?: McpServer[]
  accepted?: boolean
}> {
  return res.json() as Promise<{
    error?: { code: string; message?: string; details?: unknown }
    servers?: McpServer[]
    accepted?: boolean
  }>
}

function makeServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    name: 'alpha',
    state: 'connected',
    detail: null,
    kind: 'local',
    command: ['serve'],
    url: null,
    oauth: null,
    ...overrides,
  }
}

describe('这一层出的工具服务器', () => {
  it('出来的是版本化的方言，不是 agent 自己那张表', async () => {
    const own = ownDirectory()
    const provider = new FakeAgentProvider({
      mcpServers: [makeServer()],
    })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request(`/api/bff/mcp?directories=${encodeURIComponent(own)}`)

    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.servers).toEqual([makeServer()])

    const asked = provider.calls.find((call) => call.method === 'listMcpServers')
    expect(asked?.context?.directory).toBe(own)
  })

  it('不是自己的目录，服务器不给问', async () => {
    const provider = new FakeAgentProvider({ mcpServers: [makeServer()] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request(
      `/api/bff/mcp?directories=${encodeURIComponent(otherDirectory())}`,
    )

    expect(res.status).toBe(403)
    const body = await json(res)
    expect(body.error?.code).toBe('forbidden')
    expect(provider.calls.some((call) => call.method === 'listMcpServers')).toBe(false)
  })

  it('没点名目录也能问：服务器是整个服务器的事', async () => {
    const provider = new FakeAgentProvider({ mcpServers: [makeServer()] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/mcp')

    expect(res.status).toBe(200)
    const asked = provider.calls.find((call) => call.method === 'listMcpServers')
    expect(asked?.context?.directory).toBeUndefined()
  })
})

describe('这一层出的改动', () => {
  it('改了别人的目录，不给改', async () => {
    const provider = new FakeAgentProvider({ mcpServers: [] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request(
      `/api/bff/mcp/alpha/connect?directories=${encodeURIComponent(otherDirectory())}`,
      { method: 'POST' },
    )

    expect(res.status).toBe(403)
    expect(provider.calls.some((call) => call.method === 'connectMcpServer')).toBe(false)
  })

  it('在自己的目录里，可以改', async () => {
    const provider = new FakeAgentProvider({ mcpServers: [] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request(
      `/api/bff/mcp/alpha/connect?directories=${encodeURIComponent(ownDirectory())}`,
      { method: 'POST' },
    )

    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.accepted).toBe(true)

    const asked = provider.calls.find((call) => call.method === 'connectMcpServer')
    expect(asked?.args).toEqual(['alpha'])
    expect(asked?.context?.directory).toBe(ownDirectory())
  })

  it('没有点名目录，就是改所有人的东西，只有管理员能改', async () => {
    const provider = new FakeAgentProvider({ mcpServers: [] })
    const { app } = createApp([provider], asSomebodyElse)

    const refused = await app.request('/api/bff/mcp/alpha/connect', { method: 'POST' })

    expect(refused.status).toBe(403)
    expect(provider.calls.some((call) => call.method === 'connectMcpServer')).toBe(false)

    const admin = createApp([provider], asAdmin)
    const allowed = await admin.app.request('/api/bff/mcp/alpha/connect', { method: 'POST' })

    expect(allowed.status).toBe(200)
    const asked = provider.calls.find((call) => call.method === 'connectMcpServer')
    expect(asked?.context?.directory).toBeUndefined()
  })

  it('加一个服务器是所有人的事，只有管理员能加', async () => {
    const provider = new FakeAgentProvider({ mcpServers: [] })
    const { app } = createApp([provider], asSomebodyElse)

    const refused = await app.request('/api/bff/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'alpha',
        config: { kind: 'local', enabled: true, command: ['serve'], url: null, environment: null, headers: null, timeout: null, oauth: null },
      }),
    })

    expect(refused.status).toBe(403)
    expect(provider.calls.some((call) => call.method === 'addMcpServer')).toBe(false)

    const admin = createApp([provider], asAdmin)
    const allowed = await admin.app.request('/api/bff/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'alpha',
        config: { kind: 'local', enabled: true, command: ['serve'], url: null, environment: null, headers: null, timeout: null, oauth: null },
      }),
    })

    expect(allowed.status).toBe(200)
    const asked = provider.calls.find((call) => call.method === 'addMcpServer')
    expect(asked?.args?.[0]).toBe('alpha')
    expect(asked?.args?.[1]).toMatchObject({ kind: 'local', command: ['serve'] })
  })

  it('说法不对的服务器，不给加', async () => {
    const provider = new FakeAgentProvider({ mcpServers: [] })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request('/api/bff/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', config: { kind: 'local' } }),
    })

    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error?.code).toBe('bad_request')
    expect(provider.calls.some((call) => call.method === 'addMcpServer')).toBe(false)
  })

  it('结束一次授权，代码得在', async () => {
    const provider = new FakeAgentProvider({ mcpServers: [] })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request('/api/bff/mcp/alpha/auth/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(400)
    expect(provider.calls.some((call) => call.method === 'completeMcpAuth')).toBe(false)
  })

  it('答出来的服务器里没有密钥', async () => {
    // The document a server is written down in also holds the credentials of
    // every model provider on the host. What comes back here is the server,
    // and the secret that belongs to an OAuth client is not part of it.
    const provider = new FakeAgentProvider({
      mcpServers: [
        makeServer({
          kind: 'remote',
          url: 'https://mcp.example.com',
          command: null,
          oauth: { scope: 'read things', clientId: 'the-client' },
        }),
      ],
    })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request('/api/bff/mcp')
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(text).not.toContain('clientSecret')
    expect(text).not.toContain('sk-')
  })

  it('服务器不在了，说的是没有这个服务器，不是没有会话', async () => {
    // The agent says "there is no such server", and this layer used to answer
    // "there is no such session" - a sentence about a different thing, which
    // sent the client looking for a conversation that was never in question.
    const provider = new FakeAgentProvider({ mcpServers: [] })
    provider.failWith = new ResourceNotFoundError('tool server', 'probe-server')
    const { app } = createApp([provider], asAdmin)

    const res = await app.request('/api/bff/mcp/probe-server/connect', { method: 'POST' })

    expect(res.status).toBe(404)
    const body = await json(res)
    expect(body.error?.code).toBe('resource_not_found')
    expect(body.error?.message).toBe('No tool server is known under "probe-server"')
    expect(body.error?.details).toEqual({ resource: 'tool server', id: 'probe-server' })
  })
})
