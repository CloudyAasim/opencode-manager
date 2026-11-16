import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createBffRoutes } from './index'
import { ProviderRegistry } from '../../providers/registry'
import type { AuthInstance } from '../../auth'
import { FakeAgentProvider } from '../../../test/helpers/fake-agent-provider'
import { migrate } from '../../db/migration-runner'
import { allMigrations } from '../../db/migrations'
import { ProviderAuthError } from '../../providers/contract'
import type {
  ProviderAuthMethod,
  ProviderOAuthAuthorization,
} from '@opencode-manager/shared/api/v1'

function authThatFinds(session: unknown): AuthInstance {
  return {
    api: { getSession: async () => session },
  } as unknown as AuthInstance
}

const asSomebody = authThatFinds({
  session: { id: 'session-1', userId: 'user-1' },
  user: {
    id: 'user-1',
    name: 'user',
    username: 'user-1',
    email: 'user@example.com',
    role: 'user',
  },
})

let database: Database
let workspace: string
let previousWorkspacePath: string | undefined

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'bff-provider-auth-'))
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

const METHODS: Record<string, ProviderAuthMethod[]> = {
  anthropic: [{ type: 'oauth', label: 'Claude Pro / Max', prompts: null }],
}

function createApp(
  provider: FakeAgentProvider,
  options: { afterAuthorization?: () => Promise<void> } = {},
): Hono {
  const registry = new ProviderRegistry()
  registry.register(provider, { default: true })
  const app = new Hono()
  app.route('/api/bff', createBffRoutes(registry, database, { auth: asSomebody, ...options }))
  return app
}

describe('模型怎么登录这一族', () => {
  let provider: FakeAgentProvider

  beforeEach(() => {
    provider = new FakeAgentProvider({ id: 'fake', providerAuthMethods: METHODS })
  })

  it('问这一层要「每个 provider 怎么登录」，答的是版本化的话', async () => {
    const app = createApp(provider)

    const res = await app.request('/api/bff/provider-auth/methods')
    const body = await res.json() as { methods: Record<string, ProviderAuthMethod[]> }

    expect(res.status).toBe(200)
    expect(body.methods).toEqual(METHODS)
    expect(provider.calls.map((call) => call.method)).toEqual(['listProviderAuthMethods'])
  })

  it('开始一次授权，走的是契约，不是自己拼 agent 的那条路', async () => {
    const app = createApp(provider)

    const res = await app.request('/api/bff/provider-auth/anthropic/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 0, inputs: null }),
    })
    const body = await res.json() as { authorization: ProviderOAuthAuthorization }

    expect(res.status).toBe(200)
    expect(body.authorization.url).toBe('https://example.invalid/authorize')
    expect(body.authorization.method).toBe('code')
    const call = provider.calls.find((entry) => entry.method === 'authorizeProviderAuth')
    expect(call?.args[0]).toBe('anthropic')
    expect(call?.args[1]).toEqual({ method: 0, inputs: null })
  })

  it('授权完了，manager 自己的那件事也跟着做', async () => {
    let followed = 0
    const app = createApp(provider, {
      afterAuthorization: async () => {
        followed += 1
      },
    })

    const res = await app.request('/api/bff/provider-auth/anthropic/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 0, code: 'the-code' }),
    })
    const body = await res.json() as { accepted: boolean }

    expect(res.status).toBe(200)
    expect(body.accepted).toBe(true)
    expect(followed).toBe(1)
    const call = provider.calls.find((entry) => entry.method === 'completeProviderAuth')
    expect(call?.args[0]).toBe('anthropic')
    expect(call?.args[1]).toEqual({ method: 0, code: 'the-code' })
  })

  it('manager 自己的那件事没做成，授权本身还是算成了', async () => {
    const app = createApp(provider, {
      afterAuthorization: async () => {
        throw new Error('the agent did not come back')
      },
    })

    const res = await app.request('/api/bff/provider-auth/anthropic/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 0, code: null }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ accepted: true })
  })

  it('provider 不肯的时候，答的是这一层的信封，理由是这一层的话', async () => {
    provider.failWith = new ProviderAuthError('code_missing', 'field: code')
    const app = createApp(provider)

    const res = await app.request('/api/bff/provider-auth/anthropic/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 0, inputs: null }),
    })
    const body = await res.json() as {
      error: { code: string; message: string; details?: { reason?: string; detail?: string } }
    }

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('bad_request')
    expect(body.error.details?.reason).toBe('code_missing')
    expect(body.error.details?.detail).toBe('field: code')
  })

  it('请求本身不是一个授权，就是一个坏请求', async () => {
    const app = createApp(provider)

    const res = await app.request('/api/bff/provider-auth/anthropic/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'zero' }),
    })
    const body = await res.json() as { error: { code: string } }

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('bad_request')
  })

  it('凭据是 manager 自己的：写下去的是那个人的配置', async () => {
    const app = createApp(provider)

    const res = await app.request('/api/bff/provider-auth/credentials/anthropic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'sk-the-key' }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ accepted: true })
    const written = JSON.parse(
      await readFile(path.join(workspace, 'users', 'user-1', 'setting', 'opencode.json'), 'utf-8'),
    ) as { provider: Record<string, { options: { apiKey: string } }> }
    expect(written.provider.anthropic?.options.apiKey).toBe('sk-the-key')
  })

  it('凭据写的不对，就是一个坏请求', async () => {
    const app = createApp(provider)

    const res = await app.request('/api/bff/provider-auth/credentials/anthropic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: '' }),
    })
    const body = await res.json() as { error: { code: string } }

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('bad_request')
  })

  it('列出来的是有凭据的那些 provider', async () => {
    const app = createApp(provider)
    await app.request('/api/bff/provider-auth/credentials/anthropic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'sk-the-key' }),
    })

    const res = await app.request('/api/bff/provider-auth/credentials')
    const body = await res.json() as { credentials: string[] }

    expect(res.status).toBe(200)
    expect(body.credentials).toContain('anthropic')
  })

  it('把凭据拿走，它就不在名单上了', async () => {
    const app = createApp(provider)
    await app.request('/api/bff/provider-auth/credentials/anthropic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'sk-the-key' }),
    })

    const res = await app.request('/api/bff/provider-auth/credentials/anthropic', {
      method: 'DELETE',
    })
    const listed = await app.request('/api/bff/provider-auth/credentials')
    const body = await listed.json() as { credentials: string[] }

    expect(res.status).toBe(200)
    expect(body.credentials).not.toContain('anthropic')
  })
})
