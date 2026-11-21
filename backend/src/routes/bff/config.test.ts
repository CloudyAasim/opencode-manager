import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createBffRoutes } from './index'
import { ProviderRegistry } from '../../providers/registry'
import { FakeAgentProvider } from '../../../test/helpers/fake-agent-provider'
import { migrate } from '../../db/migration-runner'
import { allMigrations } from '../../db/migrations'
import { readOpenCodeConfigFile, writeOpenCodeConfigFile } from '../../services/opencode-config-file'
import { listOpenCodeConfigAudit } from '../../services/opencode-config-audit'
import type { AuthInstance } from '../../auth'

function authThatFinds(session: unknown): AuthInstance {
  return {
    api: { getSession: async () => session },
  } as unknown as AuthInstance
}

const asAdmin = authThatFinds({
  session: { id: 'session-1', userId: 'user-1' },
  user: {
    id: 'user-1',
    name: 'admin',
    username: 'user-1',
    email: 'admin@example.com',
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

const CONFIG_WITH_A_KEY = JSON.stringify({
  provider: {
    acme: {
      options: {
        apiKey: 'sk-live-the-secret-one',
        baseURL: 'https://acme.test',
      },
    },
  },
})

describe('这一层出的配置', () => {
  let database: Database
  let workspace: string
  let previousWorkspacePath: string | undefined
  let provider: FakeAgentProvider

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'bff-config-'))
    previousWorkspacePath = process.env.WORKSPACE_PATH
    process.env.WORKSPACE_PATH = workspace
    database = new Database(':memory:')
    migrate(database, allMigrations)
    provider = new FakeAgentProvider({
      effectiveConfiguration: {
        provider: { acme: { options: { apiKey: 'sk-effective-the-secret-one' } } },
      },
    })
  })

  afterEach(async () => {
    database.close()
    if (previousWorkspacePath === undefined) {
      delete process.env.WORKSPACE_PATH
    } else {
      process.env.WORKSPACE_PATH = previousWorkspacePath
    }
    await rm(workspace, { recursive: true, force: true })
  })

  function app(auth: AuthInstance = asAdmin): Hono {
    const registry = new ProviderRegistry()
    registry.register(provider, { default: true })
    const instance = new Hono()
    instance.route('/api/bff', createBffRoutes(registry, database, { auth }))
    return instance
  }

  it('凭据不进浏览器', async () => {
    await writeOpenCodeConfigFile(CONFIG_WITH_A_KEY, 'opencode.jsonc')

    const res = await app().request('/api/bff/config')
    const body = await res.text()

    expect(res.status).toBe(200)
    // 整个响应里一个密钥都不能有——不是只有 content 里没有，是哪儿都没有。
    expect(body).not.toContain('sk-live-the-secret-one')
    expect(body).toContain('***')
    // 而路径留着，服务端才知道自己的值该放回哪儿。
    expect(body).toContain('apiKey')
  })

  it('agent 自己说的那份，也遮住', async () => {
    const res = await app().request('/api/bff/config/effective')
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(body).not.toContain('sk-effective-the-secret-one')
    expect(body).toContain('***')
  })

  it('没有配置的时候，说的是「没有配置」，不是「没有会话」', async () => {
    const res = await app().request('/api/bff/config')
    const body = await res.json() as { error: { code: string; message: string; details?: unknown } }

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('resource_not_found')
    expect(body.error.message).toBe('No configuration is known')
    expect(body.error.details).toMatchObject({ resource: 'configuration' })
  })

  it('配置是全家的，所以只有管理员能动', async () => {
    await writeOpenCodeConfigFile(CONFIG_WITH_A_KEY, 'opencode.jsonc')
    const instance = app(asSomebodyElse)

    const get = await instance.request('/api/bff/config')
    const effective = await instance.request('/api/bff/config/effective')
    const put = await instance.request('/api/bff/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { theme: 'light' } }),
    })

    expect([get.status, effective.status, put.status]).toEqual([403, 403, 403])
    // 拒绝要发生在读之前：一个先看内容再拒绝的门，会告诉陌生人他们写对没有。
    expect(await readOpenCodeConfigFile()).not.toBeNull()
    const onDisk = await readOpenCodeConfigFile()
    expect(onDisk?.content).toMatchObject({ provider: { acme: { options: { apiKey: 'sk-live-the-secret-one' } } } })
  })

  it('客户端写另一个键，算不上改键', async () => {
    await writeOpenCodeConfigFile(CONFIG_WITH_A_KEY, 'opencode.jsonc')

    const res = await app().request('/api/bff/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: {
          provider: { acme: { options: { apiKey: 'sk-from-the-browser', baseURL: 'https://acme.test' } } },
        },
      }),
    })

    expect(res.status).toBe(200)
    const onDisk = await readOpenCodeConfigFile()
    expect(onDisk?.content).toMatchObject({
      provider: { acme: { options: { apiKey: 'sk-live-the-secret-one' } } },
    })
  })

  it('改不成的，得在回答里点名——不然人以为改了', async () => {
    await writeOpenCodeConfigFile(CONFIG_WITH_A_KEY, 'opencode.jsonc')

    const res = await app().request('/api/bff/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: {
          provider: { acme: { options: { apiKey: 'sk-from-the-browser', baseURL: 'https://acme.test' } } },
        },
      }),
    })
    const body = await res.json() as { overriddenCredentials?: string[] }

    expect(res.status).toBe(200)
    expect(body.overriddenCredentials).toEqual(['provider.acme.options.apiKey'])
  })

  it('只是把别的改了，没有改不成的，就不说', async () => {
    await writeOpenCodeConfigFile(CONFIG_WITH_A_KEY, 'opencode.jsonc')

    const res = await app().request('/api/bff/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: {
          theme: 'light',
          provider: { acme: { options: { apiKey: '***', baseURL: 'https://acme.test' } } },
        },
      }),
    })
    const body = await res.json() as { overriddenCredentials?: string[] }

    expect(res.status).toBe(200)
    expect(body.overriddenCredentials).toEqual([])
  })

  it('provider 没了，键跟着走', async () => {
    await writeOpenCodeConfigFile(CONFIG_WITH_A_KEY, 'opencode.jsonc')

    const res = await app().request('/api/bff/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { provider: {} } }),
    })

    expect(res.status).toBe(200)
    const onDisk = await readOpenCodeConfigFile()
    expect(onDisk?.content).toEqual({ provider: {} })
  })

  it('文本形态也一样：服务端把自己的键放回去', async () => {
    await writeOpenCodeConfigFile(CONFIG_WITH_A_KEY, 'opencode.jsonc')

    // 客户端拿到的是遮过的文本，它改了别的，键那行它看见的是 ***。
    const masked = CONFIG_WITH_A_KEY.replace('sk-live-the-secret-one', '***')
    const res = await app().request('/api/bff/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: masked, source: 'opencode.jsonc' }),
    })

    expect(res.status).toBe(200)
    const onDisk = await readOpenCodeConfigFile()
    expect(onDisk?.rawContent).toContain('sk-live-the-secret-one')
  })

  it('改完的东西，回来的时候还是遮着的', async () => {
    await writeOpenCodeConfigFile(CONFIG_WITH_A_KEY, 'opencode.jsonc')

    const res = await app().request('/api/bff/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { theme: 'light', provider: { acme: { options: { apiKey: '***' } } } } }),
    })
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(body).not.toContain('sk-live-the-secret-one')
    expect(body).toContain('***')
  })

  it('改了别的，得说清楚 agent 要不要再读一遍', async () => {
    await writeOpenCodeConfigFile(CONFIG_WITH_A_KEY, 'opencode.jsonc')

    const res = await app().request('/api/bff/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { theme: 'light', provider: { acme: { options: { apiKey: '***' } } } } }),
    })
    const body = await res.json() as { configuration: { content: { theme?: string } }; restartRequired?: boolean }

    expect(res.status).toBe(200)
    expect(body.configuration.content.theme).toBe('light')
    expect(body.restartRequired).toBe(true)
  })

  it('写过了，谁写的，得留下', async () => {
    await writeOpenCodeConfigFile(CONFIG_WITH_A_KEY, 'opencode.jsonc')

    await app().request('/api/bff/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'user-agent': 'vitest' },
      body: JSON.stringify({ content: { theme: 'light', provider: { acme: { options: { apiKey: '***' } } } } }),
    })

    const entry = listOpenCodeConfigAudit(database).entries[0]
    expect(entry).toMatchObject({ userId: 'user-1', scope: 'global' })
  })

  it('两个人同时改，后一个知道自己改的是旧的', async () => {
    await writeOpenCodeConfigFile(CONFIG_WITH_A_KEY, 'opencode.jsonc')
    const stale = (await app().request('/api/bff/config')).json() as Promise<{ configuration: { revision: string } }>
    const { configuration } = await stale

    const first = await app().request('/api/bff/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { theme: 'light', provider: { acme: { options: { apiKey: '***' } } } },
        expectedRevision: configuration.revision,
      }),
    })
    expect(first.status).toBe(200)

    const second = await app().request('/api/bff/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { theme: 'dark', provider: { acme: { options: { apiKey: '***' } } } },
        expectedRevision: configuration.revision,
      }),
    })
    const body = await second.json() as { error: { code: string; message: string; details?: unknown } }

    expect(second.status).toBe(409)
    // 冲突有它自己的话：客户端该知道「再读一遍」，而不是「你写错了」。
    expect(body.error.code).toBe('conflict')
    expect(body.error.details).toMatchObject({ expectedRevision: configuration.revision })
  })

  it('写的不是 JSON，说的是「不是 JSON」', async () => {
    const res = await app().request('/api/bff/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    })
    const body = await res.json() as { error: { code: string; message: string } }

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('bad_request')
    expect(body.error.message).toBe('The body is not JSON')
  })

  it('写的不是配置，说的是「不是配置」', async () => {
    const res = await app().request('/api/bff/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 123 }),
    })
    const body = await res.json() as { error: { code: string; message: string } }

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('bad_request')
    expect(body.error.message).toBe('That is not a configuration')
  })

  it('写的不是一个来源，说的是「不是一个来源」', async () => {
    const res = await app().request('/api/bff/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { theme: 'light' }, source: 'not-a-source.json' }),
    })
    const body = await res.json() as { error: { code: string; message: string } }

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('bad_request')
    expect(body.error.message).toBe('That is not a configuration source')
  })
})
