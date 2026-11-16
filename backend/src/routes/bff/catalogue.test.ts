import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createBffRoutes } from './index'
import { ProviderRegistry } from '../../providers/registry'
import type { AuthInstance } from '../../auth'
import { FakeAgentProvider } from '../../../test/helpers/fake-agent-provider'
import { migrate } from '../../db/migration-runner'
import { allMigrations } from '../../db/migrations'
import type { Model, Provider } from '@opencode-manager/shared/api/v1'

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
  workspace = await mkdtemp(path.join(tmpdir(), 'bff-catalogue-'))
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
  error?: { code: string }
  providers?: Provider[]
  default?: Record<string, string>
  files?: string[]
}> {
  return res.json() as Promise<{
    error?: { code: string }
    providers?: Provider[]
    default?: Record<string, string>
    files?: string[]
  }>
}

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    limit: { context: 200000, output: 64000 },
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    capabilities: { attachment: true, reasoning: true, temperature: true, toolCall: true },
    modalities: { input: ['text', 'image'], output: ['text'] },
    variants: { high: { reasoningEffort: 'high' } },
    ...overrides,
  }
}

describe('这一层出的模型目录', () => {
  it('目录问一次，出来的就是版本化的方言', async () => {
    const own = ownDirectory()
    const provider = new FakeAgentProvider({
      providerList: {
        providers: [
          {
            id: 'anthropic',
            name: 'Anthropic',
            env: ['ANTHROPIC_API_KEY'],
            models: [makeModel()],
            connected: true,
          },
        ],
        default: { anthropic: 'claude-sonnet-4' },
      },
    })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request(`/api/bff/providers?directories=${encodeURIComponent(own)}`)

    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.providers).toEqual([
      {
        id: 'anthropic',
        name: 'Anthropic',
        env: ['ANTHROPIC_API_KEY'],
        models: [makeModel()],
        connected: true,
      },
    ])
    expect(body.default).toEqual({ anthropic: 'claude-sonnet-4' })

    const asked = provider.calls.find((call) => call.method === 'listProviders')
    expect(asked?.context?.directory).toBe(own)
  })

  it('模型的身份是目录里的那个键，不是上游 API 认得的那个名字', async () => {
    // 同一个模型有两个名字：目录里的键，和上游 API 认得的名字。客户端拿
    // 目录里的键，因为会话就是用它开的——用另一个名字开出来的会话，agent
    // 是不认得的。
    const provider = new FakeAgentProvider({
      providerList: {
        providers: [
          {
            id: 'github-copilot',
            name: 'GitHub Copilot',
            env: [],
            models: [makeModel({ id: 'claude-opus-4.7-fast', name: 'Claude Opus 4.7 Fast' })],
            connected: false,
          },
        ],
        default: {},
      },
    })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request('/api/bff/providers')

    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.providers?.[0]?.models?.[0]?.id).toBe('claude-opus-4.7-fast')
    expect(body.providers?.[0]?.connected).toBe(false)
  })

  it('目录属于 agent，不属于工作目录：没点名目录也问得出', async () => {
    const provider = new FakeAgentProvider({
      providerList: { providers: [], default: {} },
    })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request('/api/bff/providers')

    expect(res.status).toBe(200)
    const asked = provider.calls.find((call) => call.method === 'listProviders')
    expect(asked?.context?.directory).toBeUndefined()
  })

  it('不是自己的目录，目录不给问', async () => {
    const provider = new FakeAgentProvider({
      providerList: { providers: [], default: {} },
    })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request(
      `/api/bff/providers?directories=${encodeURIComponent(otherDirectory())}`,
    )

    expect(res.status).toBe(403)
    const body = await json(res)
    expect(body.error?.code).toBe('forbidden')
    expect(provider.calls.some((call) => call.method === 'listProviders')).toBe(false)
  })
})

describe('这一层出的找文件', () => {
  it('问的是 agent，目录是调用者的那个', async () => {
    const own = ownDirectory()
    const provider = new FakeAgentProvider({
      files: ['src/index.ts', 'src/other.ts', 'README.md'],
    })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request(
      `/api/bff/files/search?query=${encodeURIComponent('index')}&directories=${encodeURIComponent(own)}`,
    )

    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.files).toEqual(['src/index.ts'])

    const asked = provider.calls.find((call) => call.method === 'searchFiles')
    expect(asked?.args).toEqual(['index'])
    expect(asked?.context?.directory).toBe(own)
  })

  it('没有词，就是没有话问，不是「一个文件都没有」', async () => {
    const provider = new FakeAgentProvider({ files: ['README.md'] })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request('/api/bff/files/search')

    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error?.code).toBe('bad_request')
    expect(provider.calls.some((call) => call.method === 'searchFiles')).toBe(false)
  })

  it('没有点名目录，就是没有地方找', async () => {
    const provider = new FakeAgentProvider({ files: ['README.md'] })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request('/api/bff/files/search?query=readme')

    expect(res.status).toBe(400)
    expect(provider.calls.some((call) => call.method === 'searchFiles')).toBe(false)
  })

  it('不是自己的目录，文件不给找', async () => {
    const provider = new FakeAgentProvider({ files: ['README.md'] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request(
      `/api/bff/files/search?query=readme&directories=${encodeURIComponent(otherDirectory())}`,
    )

    expect(res.status).toBe(403)
    const body = await json(res)
    expect(body.error?.code).toBe('forbidden')
    expect(provider.calls.some((call) => call.method === 'searchFiles')).toBe(false)
  })
})
