import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createBffRoutes } from './index'
import { ProviderRegistry } from '../../providers/registry'
import type { AuthInstance } from '../../auth'
import {
  FakeAgentProvider,
  makePendingPermission,
  makePendingQuestion,
} from '../../../test/helpers/fake-agent-provider'
import { migrate } from '../../db/migration-runner'
import { allMigrations } from '../../db/migrations'
import type { PendingPermission, PendingQuestion } from '@opencode-manager/shared/api/v1'

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
  workspace = await mkdtemp(path.join(tmpdir(), 'bff-pending-'))
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

describe('这一层出的待办', () => {
  it('一次请求就能拿到好几个目录的待办', async () => {
    const provider = new FakeAgentProvider({
      pendingPermissions: [makePendingPermission({ id: 'perm-1' })],
      pendingQuestions: [makePendingQuestion({ id: 'quest-1' })],
    })
    const { app } = createApp([provider])

    const res = await app.request('/api/bff/pending?directories=/work&directories=/other')

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      permissions: PendingPermission[]
      questions: PendingQuestion[]
    }
    // The fake agent answers every directory with the same list, because it
    // does not know about directories. What this asserts is the merge: one
    // answer carries both directories' requests.
    expect(body.permissions.map((item) => item.id)).toEqual(['perm-1', 'perm-1'])
    expect(body.questions.map((item) => item.id)).toEqual(['quest-1', 'quest-1'])
  })

  it('每个目录都要问一遍，而不是只问第一个', async () => {
    const provider = new FakeAgentProvider()
    const { app } = createApp([provider])

    await app.request('/api/bff/pending?directories=/work&directories=/other')

    const asked = provider.calls.filter((call) => call.method === 'listPendingPermissions')
    expect(asked).toHaveLength(2)
    expect(asked.map((call) => (call.args[0] as { directory?: string }).directory)).toEqual([
      '/work',
      '/other',
    ])

    const askedQuestions = provider.calls.filter((call) => call.method === 'listPendingQuestions')
    expect(askedQuestions).toHaveLength(2)
  })

  it('一次请求就够了，而不是每个目录问两次', async () => {
    // The client used to ask the agent for the pending permissions of each
    // directory and the pending questions of each directory. Two requests per
    // directory, in the browser.
    const provider = new FakeAgentProvider()
    const { app } = createApp([provider])

    await app.request('/api/bff/pending?directories=/work&directories=/other&directories=/third')

    expect(provider.calls.filter((call) => call.method === 'listPendingPermissions')).toHaveLength(3)
    expect(provider.calls.filter((call) => call.method === 'listPendingQuestions')).toHaveLength(3)
  })

  it('一个目录都没说，就该被问一句，而不是给一个空列表', async () => {
    const { app } = createApp([new FakeAgentProvider()])

    const res = await app.request('/api/bff/pending')

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('bad_request')
  })

  it('登录了才有这个门', async () => {
    const { app } = createApp([new FakeAgentProvider()], signedOut)

    const res = await app.request('/api/bff/pending?directories=/work')

    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('unauthorized')
  })

  it('不是自己的目录，点名也没用', async () => {
    const provider = new FakeAgentProvider({
      pendingPermissions: [makePendingPermission({ directory: '/work' })],
    })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/pending?directories=/work')

    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('forbidden')
  })

  it('别人的待办不该出现在列表里', async () => {
    // The directory asked for is the caller's own, so the request is allowed.
    // The conversation inside it belongs to somebody else, and a pending
    // request belongs to a conversation - so the narrowing is the server's
    // job, and it happens here.
    const provider = new FakeAgentProvider({
      pendingPermissions: [makePendingPermission({ directory: '/somebody/else' })],
      pendingQuestions: [makePendingQuestion({ directory: '/somebody/else' })],
    })
    const { app } = createApp([provider], asSomebodyElse)

    const own = path.join(workspace, 'users', 'user-2', 'workspace')
    const res = await app.request(`/api/bff/pending?directories=${encodeURIComponent(own)}`)

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      permissions: PendingPermission[]
      questions: PendingQuestion[]
    }
    expect(body.permissions).toEqual([])
    expect(body.questions).toEqual([])
  })

  it('待办带着它是在哪儿被问出来的', async () => {
    const provider = new FakeAgentProvider({
      pendingPermissions: [makePendingPermission({ directory: '/work' })],
    })
    const { app } = createApp([provider])

    const res = await app.request('/api/bff/pending?directories=/work')

    const body = (await res.json()) as { permissions: PendingPermission[] }
    expect(body.permissions[0]?.directory).toBe('/work')
  })
})
