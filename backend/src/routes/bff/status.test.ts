import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createBffRoutes } from './index'
import { ProviderRegistry } from '../../providers/registry'
import type { AuthInstance } from '../../auth'
import { FakeAgentProvider, makeSession } from '../../../test/helpers/fake-agent-provider'
import { migrate } from '../../db/migration-runner'
import { allMigrations } from '../../db/migrations'
import { recordAgentSession } from '../../services/agent-session'
import type { ConversationStatus } from '@opencode-manager/shared/api/v1'

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

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'bff-status-'))
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
  statuses?: Record<string, ConversationStatus>
}> {
  return res.json() as Promise<{
    error?: { code: string }
    statuses?: Record<string, ConversationStatus>
  }>
}

describe('这一层出的状态', () => {
  beforeEach(() => {
    // The ledger is shared by the whole file, and a row left behind by one
    // test would decide another one's answer.
    database.prepare('DELETE FROM ocm_agent_session').run()
  })

  it('一个目录问一次，问出来的就是版本化的方言', async () => {
    const own = ownDirectory()
    const provider = new FakeAgentProvider({
      sessions: [makeSession({ id: 'ses-1', directory: own })],
      statuses: {
        'ses-1': { type: 'busy' },
        'ses-2': { type: 'retry', attempt: 2, message: 'the upstream said no', next: 5000 },
      },
    })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request(`/api/bff/status?directories=${encodeURIComponent(own)}`)

    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.statuses).toEqual({
      'ses-1': { type: 'busy' },
      'ses-2': { type: 'retry', attempt: 2, message: 'the upstream said no', next: 5000 },
    })

    const asked = provider.calls.find((call) => call.method === 'listSessionStatuses')
    expect(asked?.context?.directory).toBe(own)
  })

  it('别人的会话，状态不给看', async () => {
    const own = ownDirectory()
    recordAgentSession(database, {
      sessionId: 'ses-theirs',
      userId: 'user-1',
      username: 'user',
      role: 'admin',
      directory: own,
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({
      sessions: [makeSession({ id: 'ses-theirs', directory: own })],
      statuses: { 'ses-theirs': { type: 'busy' } },
    })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request(`/api/bff/status?directories=${encodeURIComponent(own)}`)

    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.statuses).toEqual({})
  })

  it('没点名目录，就没话说要看谁的', async () => {
    const provider = new FakeAgentProvider({ statuses: { 'ses-1': { type: 'busy' } } })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request('/api/bff/status')

    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error?.code).toBe('bad_request')
    expect(provider.calls.some((call) => call.method === 'listSessionStatuses')).toBe(false)
  })

  it('不是自己的目录，不给问', async () => {
    const provider = new FakeAgentProvider({ statuses: { 'ses-1': { type: 'busy' } } })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request(
      `/api/bff/status?directories=${encodeURIComponent(path.join(workspace, 'users', 'user-1', 'workspace'))}`,
    )

    expect(res.status).toBe(403)
    const body = await json(res)
    expect(body.error?.code).toBe('forbidden')
    expect(provider.calls.some((call) => call.method === 'listSessionStatuses')).toBe(false)
  })
})
