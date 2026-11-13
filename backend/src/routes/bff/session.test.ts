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
import { findAgentSession, recordAgentSession } from '../../services/agent-session'
import type { Session } from '@opencode-manager/shared/api/v1'

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
const signedOut = authThatFinds(null)

let database: Database
let workspace: string
let previousWorkspacePath: string | undefined

/** The working directory that belongs to the person calling. */
function ownDirectory(): string {
  return path.join(workspace, 'users', 'user-2', 'workspace')
}

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'bff-session-'))
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

function directoryOf(call: { context?: { directory?: string } } | undefined): string | undefined {
  return call?.context?.directory
}

function json(res: Response): Promise<{ error?: { code: string }; session?: Session }> {
  return res.json() as Promise<{ error?: { code: string }; session?: Session }>
}

describe('这一层出的一个会话', () => {
  beforeEach(() => {
    // The ledger is shared by the whole file, and a row left behind by one
    // test would decide another one's answer.
    database.prepare('DELETE FROM ocm_agent_session').run()
  })

  it('台账说了算：会话在哪儿，agent 就被问到哪儿', async () => {
    const own = ownDirectory()
    recordAgentSession(database, {
      sessionId: 'ses-1',
      userId: 'user-2',
      username: 'other',
      role: 'user',
      directory: own,
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({ sessions: [makeSession({ id: 'ses-1', directory: own })] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-1')

    expect(res.status).toBe(200)
    const asked = provider.calls.find((call) => call.method === 'getSession')
    expect(directoryOf(asked)).toBe(own)
    // The ledger answered it, so the agent was never asked for a list.
    expect(provider.calls.some((call) => call.method === 'listSessions')).toBe(false)
  })

  it('台账没有问 agent：agent 自己知道会话在哪儿', async () => {
    const provider = new FakeAgentProvider({
      sessions: [makeSession({ id: 'ses-1', directory: '/where/it/is' })],
    })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request('/api/bff/sessions/ses-1')

    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.session?.directory).toBe('/where/it/is')
    // Asked without a directory, because naming one would be guessing.
    const asked = provider.calls.find((call) => call.method === 'getSession')
    expect(asked?.context).toEqual({})
  })

  it('台账没有、agent 也没说，就去调用者自己的目录里找', async () => {
    const own = ownDirectory()
    const provider = new FakeAgentProvider({ sessions: [makeSession({ id: 'ses-1', directory: null })] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request(`/api/bff/sessions/ses-1?directories=${encodeURIComponent(own)}`)

    expect(res.status).toBe(200)
    const listed = provider.calls.filter((call) => call.method === 'listSessions')
    expect(listed).toHaveLength(1)
    expect(directoryOf(listed[0])).toBe(own)
  })

  it('agent 不认识的会话，就跟没有一样', async () => {
    const provider = new FakeAgentProvider({ sessions: [] })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request('/api/bff/sessions/ses-nope')

    expect(res.status).toBe(404)
    const body = await json(res)
    expect(body.error?.code).toBe('not_found')
  })

  it('别人的会话，跟没有一样', async () => {
    // The ledger says the conversation belongs to somebody else. It is
    // answered exactly like one that does not exist, so that a caller who may
    // not have it cannot learn that it is there.
    recordAgentSession(database, {
      sessionId: 'ses-theirs',
      userId: 'user-1',
      username: 'user',
      role: 'admin',
      directory: ownDirectory(),
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({
      sessions: [makeSession({ id: 'ses-theirs', directory: ownDirectory() })],
    })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-theirs')

    expect(res.status).toBe(404)
    const body = await json(res)
    expect(body.error?.code).toBe('not_found')
  })

  it('别人的目录里的会话，也不是你的', async () => {
    // No ledger row, and the conversation sits outside the caller's own
    // reach. Nothing says it is theirs, so it is not theirs.
    const provider = new FakeAgentProvider({
      sessions: [makeSession({ id: 'ses-1', directory: '/somebody/else' })],
    })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-1')

    expect(res.status).toBe(404)
  })

  it('点名别人的目录，直接被拒', async () => {
    const provider = new FakeAgentProvider({ sessions: [makeSession({ id: 'ses-1' })] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-1?directories=%2Fsomebody%2Felse')

    expect(res.status).toBe(403)
    const body = await json(res)
    expect(body.error?.code).toBe('forbidden')
  })

  it('登录了才有这个门', async () => {
    const { app } = createApp([new FakeAgentProvider()], signedOut)

    const res = await app.request('/api/bff/sessions/ses-1')

    expect(res.status).toBe(401)
    const body = await json(res)
    expect(body.error?.code).toBe('unauthorized')
  })

  it('新建的会话要写进台账', async () => {
    const own = ownDirectory()
    const provider = new FakeAgentProvider()
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hello', directory: own }),
    })

    expect(res.status).toBe(200)
    const body = await json(res)
    const record = findAgentSession(database, body.session!.id)
    expect(record?.userId).toBe('user-2')
    expect(record?.username).toBe('user-2')
    expect(record?.directory).toBe(own)
    expect(record?.source).toBe('bff')
  })

  it('不说在哪儿建的，就不该建', async () => {
    const provider = new FakeAgentProvider()
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hello' }),
    })

    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error?.code).toBe('bad_request')
    expect(provider.calls.some((call) => call.method === 'createSession')).toBe(false)
  })

  it('在别人的目录里建，直接被拒', async () => {
    const provider = new FakeAgentProvider()
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hello', directory: '/somebody/else' }),
    })

    expect(res.status).toBe(403)
    const body = await json(res)
    expect(body.error?.code).toBe('forbidden')
    expect(provider.calls.some((call) => call.method === 'createSession')).toBe(false)
  })

  it('改名要问到会话在哪儿', async () => {
    const own = ownDirectory()
    recordAgentSession(database, {
      sessionId: 'ses-1',
      userId: 'user-2',
      username: 'other',
      role: 'user',
      directory: own,
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({ sessions: [makeSession({ id: 'ses-1', directory: own })] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'A new name' }),
    })

    expect(res.status).toBe(200)
    const renamed = provider.calls.find((call) => call.method === 'renameSession')
    expect(renamed?.args[1]).toBe('A new name')
    expect(directoryOf(renamed)).toBe(own)
  })

  it('删除要问到会话在哪儿', async () => {
    const own = ownDirectory()
    recordAgentSession(database, {
      sessionId: 'ses-1',
      userId: 'user-2',
      username: 'other',
      role: 'user',
      directory: own,
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({ sessions: [makeSession({ id: 'ses-1', directory: own })] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-1', { method: 'DELETE' })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { deleted: boolean; id: string }
    expect(body).toEqual({ deleted: true, id: 'ses-1' })
    const removed = provider.calls.find((call) => call.method === 'deleteSession')
    expect(directoryOf(removed)).toBe(own)
  })

  it('别人的会话，不该被删掉', async () => {
    recordAgentSession(database, {
      sessionId: 'ses-theirs',
      userId: 'user-1',
      username: 'user',
      role: 'admin',
      directory: ownDirectory(),
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({
      sessions: [makeSession({ id: 'ses-theirs', directory: ownDirectory() })],
    })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-theirs', { method: 'DELETE' })

    expect(res.status).toBe(404)
    expect(provider.calls.some((call) => call.method === 'deleteSession')).toBe(false)
  })

  it('中止要问到会话在哪儿', async () => {
    const own = ownDirectory()
    recordAgentSession(database, {
      sessionId: 'ses-1',
      userId: 'user-2',
      username: 'other',
      role: 'user',
      directory: own,
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({ sessions: [makeSession({ id: 'ses-1', directory: own })] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-1/abort', { method: 'POST' })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { accepted: boolean }
    expect(body).toEqual({ accepted: true })
    const aborted = provider.calls.find((call) => call.method === 'abortSession')
    expect(directoryOf(aborted)).toBe(own)
  })
})
