import { describe, expect, it, beforeAll, afterAll } from 'vitest'
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
import type { Session } from '@opencode-manager/shared/api/v1'

function authThatFinds(session: unknown): AuthInstance {
  return {
    api: { getSession: async () => session },
  } as unknown as AuthInstance
}

const asAdmin = authThatFinds({
  session: { id: 'session-1', userId: 'user-1' },
  user: { id: 'user-1', name: 'user', email: 'user@example.com', role: 'admin' },
})
const asSomebodyElse = authThatFinds({
  session: { id: 'session-2', userId: 'user-2' },
  user: { id: 'user-2', name: 'other', email: 'other@example.com', role: 'user' },
})
const signedOut = authThatFinds(null)

let database: Database
let workspace: string
let previousWorkspacePath: string | undefined

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'bff-'))
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

describe('给前端的那一层', () => {
  it('一次请求就能拿到好几个目录的会话', async () => {
    const provider = new FakeAgentProvider({
      sessions: [makeSession({ id: 'one' }), makeSession({ id: 'two' })],
    })
    const { app } = createApp([provider])

    const res = await app.request('/api/bff/sessions?directories=/work&directories=/other')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { sessions: Session[] }
    // The fake agent answers every directory with the same list, because it
    // does not know about directories. What this asserts is the merge: one
    // answer carries both directories' pages.
    expect(body.sessions.map((session) => session.id).sort()).toEqual(['one', 'one', 'two', 'two'])
  })

  it('每个目录都要问一遍，而不是只问第一个', async () => {
    const provider = new FakeAgentProvider()
    const { app } = createApp([provider])

    await app.request('/api/bff/sessions?directories=/work&directories=/other')

    const asked = provider.calls.filter((call) => call.method === 'listSessions')
    expect(asked).toHaveLength(2)
    expect(asked.map((call) => (call.args[0] as { directory?: string }).directory)).toEqual(['/work', '/other'])
  })

  it('条数、搜索和游标都要跟着目录一起送到 agent 那里', async () => {
    const provider = new FakeAgentProvider()
    const { app } = createApp([provider])

    await app.request('/api/bff/sessions?directories=/work&limit=25&search=deploy&cursors=' + encodeURIComponent(JSON.stringify({ '/work': 'cur_1' })))

    const asked = provider.calls.find((call) => call.method === 'listSessions')
    expect(asked?.args[1]).toEqual({ limit: 25, cursor: 'cur_1', search: 'deploy' })
  })

  it('每个目录下一页的位置要各自记着', async () => {
    const provider = new FakeAgentProvider({ sessions: [makeSession()], nextCursor: 'cur_2' })
    const { app } = createApp([provider])

    const res = await app.request('/api/bff/sessions?directories=/work&directories=/other')

    const body = (await res.json()) as { cursors: Record<string, string> }
    expect(body.cursors).toEqual({ '/work': 'cur_2', '/other': 'cur_2' })
  })

  it('没有下一页的目录就不用占位置', async () => {
    const provider = new FakeAgentProvider({ sessions: [makeSession()] })
    const { app } = createApp([provider])

    const res = await app.request('/api/bff/sessions?directories=/work')

    const body = (await res.json()) as { cursors: Record<string, string> }
    expect(body.cursors).toEqual({})
  })

  it('一个目录都没说，就该被问一句，而不是给一个空列表', async () => {
    const { app } = createApp([new FakeAgentProvider()])

    const res = await app.request('/api/bff/sessions')

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('bad_request')
  })

  it('读不懂的游标不算游标，列表从头开始而不是报错', async () => {
    const provider = new FakeAgentProvider()
    const { app } = createApp([provider])

    const res = await app.request('/api/bff/sessions?directories=/work&cursors=not-json')

    expect(res.status).toBe(200)
    const asked = provider.calls.find((call) => call.method === 'listSessions')
    expect(asked?.args[1]).toEqual({ limit: undefined, cursor: undefined, search: undefined })
  })

  it('登录了才有这个门', async () => {
    const { app } = createApp([new FakeAgentProvider()], signedOut)

    const res = await app.request('/api/bff/sessions?directories=/work')

    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('unauthorized')
  })

  it('不是自己的目录，点名也没用', async () => {
    const provider = new FakeAgentProvider({ sessions: [makeSession({ directory: '/work' })] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions?directories=/work')

    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('forbidden')
  })

  it('别人的会话不该出现在列表里', async () => {
    // The directory asked for is the caller's own, so the request is allowed.
    // The conversation inside it belongs to somebody else, and an agent knows
    // about conversations rather than about people - so the narrowing is the
    // server's job, and it happens here.
    const provider = new FakeAgentProvider({ sessions: [makeSession({ directory: '/somebody/else' })] })
    const { app } = createApp([provider], asSomebodyElse)

    const own = path.join(workspace, 'users', 'user-2', 'workspace')
    const res = await app.request(`/api/bff/sessions?directories=${encodeURIComponent(own)}`)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { sessions: Session[] }
    expect(body.sessions).toEqual([])
  })
})
