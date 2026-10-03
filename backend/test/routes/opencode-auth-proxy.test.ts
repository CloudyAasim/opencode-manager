import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { createAuthenticatedOpenCodeProxyRoutes } from '../../src/routes/opencode-auth-proxy'
import { getUserSettingPath } from '@opencode-manager/shared/config/env'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { OpenCodeSupervisor } from '../../src/services/opencode-supervisor'
import type { SettingsService } from '../../src/services/settings'
import { createTestDb } from '../helpers/assistant-workspace'

const proxyTestDb = createTestDb()

const isLifecycleInitializedMock = vi.hoisted(() => vi.fn().mockReturnValue(true))

vi.mock('../../src/services/opencode-single-server', () => ({
  opencodeServerManager: { isLifecycleInitialized: isLifecycleInitializedMock },
}))

const forwardRawMock = vi.hoisted(() => vi.fn<OpenCodeClient['forwardRaw']>(async () => new Response('ok', { status: 200 })))

vi.mock('../../src/services/opencode/client', () => ({
  createOpenCodeClient: vi.fn(),
}))

const passThroughAuth: MiddlewareHandler = async (c, next) => {
  await next()
}

function buildApp() {
  const app = new Hono()
  app.route(
    '/api/opencode',
    createAuthenticatedOpenCodeProxyRoutes({ forwardRaw: forwardRawMock } as unknown as OpenCodeClient, passThroughAuth, proxyTestDb),
  )
  return app
}

describe('authenticated opencode proxy routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isLifecycleInitializedMock.mockReturnValue(true)
    forwardRawMock.mockResolvedValue(new Response('ok', { status: 200 }))
  })

  /**
   * Upstream rebuilds the provider list from scratch every call, and opening
   * the model picker waits on it. `connected` in that payload reflects one
   * user's credentials, so the cache is keyed per user - that part is the whole
   * reason this test names two.
   */
  it('caches the provider listing per user instead of asking upstream every time', async () => {
    forwardRawMock.mockResolvedValue(
      new Response(JSON.stringify({ all: [], connected: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    // The cache is keyed by user, so this case needs one: an anonymous caller
    // is deliberately not cached (covered separately below).
    const app = new Hono()
    const asAlice: MiddlewareHandler = async (c, next) => {
      c.set('user' as never, { id: 'id-alice', username: 'alice', role: 'user' } as never)
      await next()
    }
    app.route(
      '/api/opencode',
      createAuthenticatedOpenCodeProxyRoutes(
        { forwardRaw: forwardRawMock } as unknown as OpenCodeClient,
        asAlice,
        proxyTestDb,
      ),
    )
    const url = '/api/opencode/provider?case=cache-1'

    const first = await app.request(url)
    expect(first.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalledTimes(1)

    const second = await app.request(url)
    expect(second.status).toBe(200)
    expect(second.headers.get('x-opencode-provider-cache')).toBe('hit')
    expect(await second.json()).toEqual({ all: [], connected: [] })
    expect(forwardRawMock).toHaveBeenCalledTimes(1)
  })

  it('does not cache anything that is not the provider listing', async () => {
    // With an identity, and on a path the cache is not meant to cover: this is
    // the case that distinguishes "caches only /provider" from "caches
    // everything for this user". buildApp() would have passed either way,
    // because an anonymous caller is never cached at all.
    const app = new Hono()
    const asAlice: MiddlewareHandler = async (c, next) => {
      c.set('user' as never, { id: 'id-alice', username: 'alice', role: 'user' } as never)
      await next()
    }
    app.route(
      '/api/opencode',
      createAuthenticatedOpenCodeProxyRoutes(
        { forwardRaw: forwardRawMock } as unknown as OpenCodeClient,
        asAlice,
        proxyTestDb,
      ),
    )

    await app.request('/api/opencode/session/ses_cache/message')
    await app.request('/api/opencode/session/ses_cache/message')
    await app.request('/api/opencode/session/ses_cache/message')

    expect(forwardRawMock).toHaveBeenCalledTimes(3)
  })

  it('does not share one tenant provider list with another', async () => {
    // principalFrom() keys off id, so a user without one is not a user at all.
    const asUser = (username: string): MiddlewareHandler => async (c, next) => {
      c.set('user' as never, { id: `id-${username}`, username, role: 'user' } as never)
      await next()
    }
    const buildFor = (username: string) => {
      const app = new Hono()
      app.route(
        '/api/opencode',
        createAuthenticatedOpenCodeProxyRoutes(
          { forwardRaw: forwardRawMock } as unknown as OpenCodeClient,
          asUser(username),
          proxyTestDb,
        ),
      )
      return app
    }

    await buildFor('alice').request('/api/opencode/provider?case=tenants')
    await buildFor('alice').request('/api/opencode/provider?case=tenants')
    expect(forwardRawMock).toHaveBeenCalledTimes(1)

    // Bob's list is his own: `connected` reflects his credentials, so Alice's
    // answer must not stand in for his.
    await buildFor('bob').request('/api/opencode/provider?case=tenants')
    expect(forwardRawMock).toHaveBeenCalledTimes(2)
  })

  it('refuses to cache when the caller cannot be identified', async () => {
    const app = new Hono()
    // no user on the context at all
    app.route(
      '/api/opencode',
      createAuthenticatedOpenCodeProxyRoutes(
        { forwardRaw: forwardRawMock } as unknown as OpenCodeClient,
        passThroughAuth,
        proxyTestDb,
      ),
    )

    await app.request('/api/opencode/provider?case=anonymous')
    await app.request('/api/opencode/provider?case=anonymous')

    expect(forwardRawMock).toHaveBeenCalledTimes(2)
  })

  it('returns 503 and never forwards when the OpenCode lifecycle is not initialized', async () => {
    isLifecycleInitializedMock.mockReturnValue(false)
    const app = buildApp()
    const res = await app.request('/api/opencode/session/ses_1/message')
    expect(res.status).toBe(503)
    expect(forwardRawMock).not.toHaveBeenCalled()
  })

  it('returns 503 through the proxy gate on a below-threshold health failure and reopens once the supervisor recovers', async () => {
    const lifecycle = { initialized: true }
    isLifecycleInitializedMock.mockImplementation(() => lifecycle.initialized)
    const manager = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      isOperationInProgress: vi.fn(() => false),
      checkHealth: vi.fn().mockResolvedValue(true),
      restart: vi.fn().mockResolvedValue(undefined),
      clearStartupError: vi.fn(),
      getLastStartupError: vi.fn(() => null),
      isLastStartupErrorNonRecoverable: vi.fn(() => false),
      setLifecycleInitialized: vi.fn((value: boolean) => { lifecycle.initialized = value }),
      getPort: vi.fn(() => 5551),
      getVersion: vi.fn(() => '1.0.137'),
      getMinVersion: vi.fn(() => '1.0.137'),
      isVersionSupported: vi.fn(() => true),
    }
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, {} as SettingsService, {
      failureThreshold: 2,
      watchEnabled: false,
    })
    await supervisor.start()

    const healthyRes = await buildApp().request('/api/opencode/session/ses_1/message')
    expect(healthyRes.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalledTimes(1)

    manager.checkHealth.mockResolvedValueOnce(false)
    const status = await supervisor.checkNow('manual')
    expect(status.state).toBe('unhealthy')
    expect(lifecycle.initialized).toBe(false)

    const blockedRes = await buildApp().request('/api/opencode/session/ses_1/message')
    expect(blockedRes.status).toBe(503)
    expect(forwardRawMock).toHaveBeenCalledTimes(1)

    manager.checkHealth.mockResolvedValueOnce(true)
    const recovered = await supervisor.checkNow('manual')
    expect(recovered.healthy).toBe(true)
    expect(lifecycle.initialized).toBe(true)

    const reopenedRes = await buildApp().request('/api/opencode/session/ses_1/message')
    expect(reopenedRes.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalledTimes(2)
  })

  it('forwards ordinary endpoints', async () => {
    const app = buildApp()
    const res = await app.request('/api/opencode/session/ses_1/message')
    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalled()
  })

  it('returns 503 for MCP auth endpoints when the OpenCode lifecycle is not initialized', async () => {
    isLifecycleInitializedMock.mockReturnValue(false)
    const app = buildApp()
    const res = await app.request('/api/opencode/mcp/evil-server/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(503)
    expect(forwardRawMock).not.toHaveBeenCalled()
  })

  it('forwards MCP auth endpoints through the lifecycle-gated proxy when initialized', async () => {
    const app = buildApp()
    const res = await app.request('/api/opencode/mcp/evil-server/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalledTimes(1)
    const forwarded = forwardRawMock.mock.calls[0]![0] as Request
    expect(forwarded.url).toContain('/api/opencode/mcp/evil-server/auth')
  })

  it('forwards MCP auth authenticate endpoints through the lifecycle-gated proxy when initialized', async () => {
    const app = buildApp()
    const res = await app.request('/api/opencode/mcp/evil-server/auth/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalledTimes(1)
    const forwarded = forwardRawMock.mock.calls[0]![0] as Request
    expect(forwarded.url).toContain('/api/opencode/mcp/evil-server/auth/authenticate')
  })

  it('forwards the session shell endpoint', async () => {
    const app = buildApp()
    const res = await app.request('/api/opencode/session/ses_1/shell', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalled()
  })

  it('forwards percent-encoded PTY paths', async () => {
    const app = buildApp()
    const res = await app.request('/api/opencode/%70ty', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalled()
  })

  it('forwards a PATCH /config mutation with plugins', async () => {
    const app = buildApp()
    const res = await app.request('/api/opencode/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'dark', plugin: ['opencode-plugin-npm'] }),
    })
    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalledTimes(1)
    const forwarded = JSON.parse(await (forwardRawMock.mock.calls[0]![0] as Request).text()) as Record<string, unknown>
    expect(forwarded).toEqual({ theme: 'dark', plugin: ['opencode-plugin-npm'] })
  })

  it('forwards a PATCH /config mutation with local MCP servers and formatter config', async () => {
    const app = buildApp()
    const body = JSON.stringify({
      formatter: { command: 'prettier' },
      mcp: { local: { type: 'local', command: ['node', 'server.js'] } },
    })
    const res = await app.request('/api/opencode/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    expect(res.status).toBe(200)
    const forwarded = JSON.parse(await (forwardRawMock.mock.calls[0]![0] as Request).text()) as Record<string, unknown>
    expect(forwarded).toEqual(JSON.parse(body))
  })

  it('forwards a malformed PATCH /config body', async () => {
    const app = buildApp()
    const res = await app.request('/api/opencode/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })
    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalledTimes(1)
    expect(await (forwardRawMock.mock.calls[0]![0] as Request).text()).toBe('{not json')
  })

  it('forwards PATCH /config mutations', async () => {
    const app = buildApp()
    const res = await app.request('/api/opencode/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'dark', plugin: ['opencode-plugin-npm'] }),
    })
    expect(res.status).toBe(200)
    const forwarded = JSON.parse(await (forwardRawMock.mock.calls[0]![0] as Request).text()) as Record<string, unknown>
    expect(forwarded.plugin).toEqual(['opencode-plugin-npm'])
  })

  it('forwards a local MCP server add', async () => {
    const app = buildApp()
    const res = await app.request('/api/opencode/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'evil',
        config: { type: 'local', command: ['node', 'server.js'] },
      }),
    })
    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalledTimes(1)
    const forwarded = JSON.parse(await (forwardRawMock.mock.calls[0]![0] as Request).text()) as Record<string, unknown>
    expect(forwarded).toEqual({
      name: 'evil',
      config: { type: 'local', command: ['node', 'server.js'] },
    })
  })

  it('forwards a remote MCP server add', async () => {
    const app = buildApp()
    const res = await app.request('/api/opencode/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'remote-server',
        config: { type: 'remote', url: 'https://example.com/mcp' },
      }),
    })
    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalledTimes(1)
    const forwarded = JSON.parse(await (forwardRawMock.mock.calls[0]![0] as Request).text()) as Record<string, unknown>
    expect(forwarded).toEqual({
      name: 'remote-server',
      config: { type: 'remote', url: 'https://example.com/mcp' },
    })
  })

  it('forwards MCP server adds', async () => {
    const app = buildApp()
    const res = await app.request('/api/opencode/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'local-server',
        config: { type: 'local', command: ['node', 'server.js'] },
      }),
    })
    expect(res.status).toBe(200)
    const forwarded = JSON.parse(await (forwardRawMock.mock.calls[0]![0] as Request).text()) as { config: { type: string } }
    expect(forwarded.config.type).toBe('local')
  })

  it('forwards a PATCH /config mutation with LSP servers and experimental hooks', async () => {
    const app = buildApp()
    const body = JSON.stringify({
      lsp: { typescript: { command: ['typescript-language-server'] } },
      experimental: {
        hook: { file_edited: [{ command: ['chmod', '+x', 'x'] }] },
        chatMaxRetries: 4,
      },
    })
    const res = await app.request('/api/opencode/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    expect(res.status).toBe(200)
    const forwarded = JSON.parse(await (forwardRawMock.mock.calls[0]![0] as Request).text()) as Record<string, unknown>
    expect(forwarded).toEqual(JSON.parse(body))
  })

  it('forwards a PATCH /config mutation without host-execution sections unchanged', async () => {
    const app = buildApp()
    const res = await app.request('/api/opencode/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'dark' }),
    })
    expect(res.status).toBe(200)
    const forwarded = JSON.parse(await (forwardRawMock.mock.calls[0]![0] as Request).text()) as Record<string, unknown>
    expect(forwarded).toEqual({ theme: 'dark' })
  })

  it('forwards a well-known auth write', async () => {
    const app = buildApp()
    const res = await app.request('/api/opencode/auth/sso.example.com', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'wellknown', key: 'SSO_TOKEN', token: 't' }),
    })
    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalledTimes(1)
    const forwarded = JSON.parse(await (forwardRawMock.mock.calls[0]![0] as Request).text()) as Record<string, unknown>
    expect(forwarded).toEqual({ type: 'wellknown', key: 'SSO_TOKEN', token: 't' })
  })

  it('forwards api and oauth auth writes', async () => {
    const app = buildApp()
    const res = await app.request('/api/opencode/auth/anthropic', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'api', key: 'sk-test' }),
    })
    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalledTimes(1)
    const forwarded = JSON.parse(await (forwardRawMock.mock.calls[0]![0] as Request).text()) as Record<string, unknown>
    expect(forwarded).toEqual({ type: 'api', key: 'sk-test' })
  })

  it('forwards auth writes', async () => {
    const app = buildApp()
    const res = await app.request('/api/opencode/auth/sso.example.com', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'wellknown', key: 'SSO_TOKEN', token: 't' }),
    })
    expect(res.status).toBe(200)
    const forwarded = JSON.parse(await (forwardRawMock.mock.calls[0]![0] as Request).text()) as Record<string, unknown>
    expect(forwarded.type).toBe('wellknown')
  })

  it('forwards a PATCH /config mutation with custom provider npm selectors', async () => {
    const app = buildApp()
    const body = JSON.stringify({
      model: 'x',
      provider: {
        evil: { npm: 'file:///repo/evil-provider.js' },
        builtin: { options: { apiKey: 'k' } },
      },
    })
    const res = await app.request('/api/opencode/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalledTimes(1)
    const forwarded = JSON.parse(await (forwardRawMock.mock.calls[0]![0] as Request).text()) as Record<string, unknown>
    expect(forwarded).toEqual(JSON.parse(body))
  })

  it('blocks a non-admin from proxying another tenant directory', async () => {
    const workspace = process.env.WORKSPACE_PATH ?? '/tmp/test-workspace'
    proxyTestDb.prepare(
      `INSERT OR REPLACE INTO repos (id, repo_url, local_path, default_branch, clone_status, cloned_at, user_id)
       VALUES (901, ?, 'r901', 'main', 'ready', ?, 'u2')`,
    ).run('https://example.com/a/b.git', Date.now())
    const directory = `${workspace}/repos/r901`

    const app = new Hono()
    app.use('/*', async (c, next) => {
      ;(c as unknown as { set: (key: string, value: unknown) => void }).set('user', { id: 'u1', role: 'user' })
      await next()
    })
    app.route(
      '/api/opencode',
      createAuthenticatedOpenCodeProxyRoutes({ forwardRaw: forwardRawMock } as unknown as OpenCodeClient, passThroughAuth, proxyTestDb),
    )

    const res = await app.request(`/api/opencode/session?directory=${encodeURIComponent(directory)}`)
    expect(res.status).toBe(403)
    expect(forwardRawMock).not.toHaveBeenCalled()
  })

  it('lets a non-admin proxy their own assistant workspace', async () => {
    const directory = getUserSettingPath('u1') + '/assistant'

    const app = new Hono()
    app.use('/*', async (c, next) => {
      ;(c as unknown as { set: (key: string, value: unknown) => void }).set('user', { id: 'u1', role: 'user', username: 'u1' })
      await next()
    })
    app.route(
      '/api/opencode',
      createAuthenticatedOpenCodeProxyRoutes({ forwardRaw: forwardRawMock } as unknown as OpenCodeClient, passThroughAuth, proxyTestDb),
    )

    const res = await app.request(`/api/opencode/session?directory=${encodeURIComponent(directory)}`)
    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalled()
  })

  it('lets an administrator proxy any directory', async () => {
    const workspace = process.env.WORKSPACE_PATH ?? '/tmp/test-workspace'
    const directory = `${workspace}/repos/r901`

    const app = new Hono()
    app.use('/*', async (c, next) => {
      ;(c as unknown as { set: (key: string, value: unknown) => void }).set('user', { id: 'root', role: 'admin' })
      await next()
    })
    app.route(
      '/api/opencode',
      createAuthenticatedOpenCodeProxyRoutes({ forwardRaw: forwardRawMock } as unknown as OpenCodeClient, passThroughAuth, proxyTestDb),
    )

    const res = await app.request(`/api/opencode/session?directory=${encodeURIComponent(directory)}`)
    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalled()
  })
})
