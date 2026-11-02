import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { createApiV1Routes } from './index'
import { ProviderRegistry } from '../../providers/registry'
import { ProviderUnavailableError } from '../../providers/contract'
import { createAuthMiddleware } from '../../auth/middleware'
import type { AuthInstance } from '../../auth'
import { FakeAgentProvider, makeMessage, makeSession } from '../../../test/helpers/fake-agent-provider'
import type { Session } from '@opencode-manager/shared/api/v1'

function authThatFinds(session: unknown): AuthInstance {
  return {
    api: { getSession: async () => session },
  } as unknown as AuthInstance
}

const signedIn = authThatFinds({
  session: { id: 'session-1', userId: 'user-1' },
  user: { id: 'user-1', name: 'user', email: 'user@example.com' },
})
const signedOut = authThatFinds(null)

function createApp(providers: FakeAgentProvider[]): { app: Hono; registry: ProviderRegistry } {
  const registry = new ProviderRegistry()
  for (const provider of providers) registry.register(provider, { default: true })
  const app = new Hono()
  app.route(
    '/api/v1',
    createApiV1Routes(registry, { name: 'opencode-manager', version: async () => '1.2.3', auth: signedIn }),
  )
  return { app, registry }
}

describe('版本化 API', () => {
  it('自己说得清自己是谁', async () => {
    const { app } = createApp([new FakeAgentProvider({ id: 'alpha' })])

    const res = await app.request('/api/v1')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      api: 'v1',
      name: 'opencode-manager',
      version: '1.2.3',
      defaultAgent: 'alpha',
    })
  })

  it('列得出有哪些 agent', async () => {
    const provider = new FakeAgentProvider({ id: 'alpha', label: 'Alpha', kind: 'cli' })
    const { app } = createApp([provider])

    const res = await app.request('/api/v1/agents')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      agents: [
        {
          id: 'alpha',
          label: 'Alpha',
          kind: 'cli',
          capabilities: ['sessions', 'messages', 'prompts', 'abort'],
          status: 'ready',
        },
      ],
    })
  })

  it('agent 自己说不可用，列出来就不可用', async () => {
    const provider = new FakeAgentProvider({ id: 'alpha', status: { status: 'unavailable' } })
    const { app } = createApp([provider])

    const res = await app.request('/api/v1/agents')
    const body = (await res.json()) as { agents: Array<{ status: string }> }

    expect(body.agents[0]?.status).toBe('unavailable')
  })

  it('没有登记过的 agent 就是一个 404，而且说清楚是哪个', async () => {
    const { app } = createApp([new FakeAgentProvider({ id: 'alpha' })])

    const res = await app.request('/api/v1/sessions?agent=beta')

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: { code: 'agent_not_found', message: 'No agent is registered under "beta"' },
    })
  })

  it('列会话', async () => {
    const provider = new FakeAgentProvider({ sessions: [makeSession()] })
    const { app } = createApp([provider])

    const res = await app.request('/api/v1/sessions')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { sessions: Session[] }
    expect(body.sessions).toHaveLength(1)
    expect(body.sessions[0]?.id).toBe('session-1')
  })

  it('工作目录要跟着请求一起送到 agent 那里', async () => {
    const provider = new FakeAgentProvider()
    const { app } = createApp([provider])

    await app.request('/api/v1/sessions?directory=%2Fwork')

    expect(provider.calls[0]?.args[0]).toEqual({ directory: '/work' })
  })

  it('开一个新会话', async () => {
    const provider = new FakeAgentProvider()
    const { app } = createApp([provider])

    const res = await app.request('/api/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Fresh' }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { session: Session }
    expect(body.session.title).toBe('Fresh')
  })

  it('请求体不合契约，就不该到 agent 那里去', async () => {
    const provider = new FakeAgentProvider()
    const { app } = createApp([provider])

    const res = await app.request('/api/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 42 }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('bad_request')
    expect(provider.calls).toHaveLength(0)
  })

  it('取一个不存在的会话，是 404', async () => {
    const { app } = createApp([new FakeAgentProvider()])

    const res = await app.request('/api/v1/sessions/nope')

    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('not_found')
  })

  it('改名', async () => {
    const provider = new FakeAgentProvider({ sessions: [makeSession()] })
    const { app } = createApp([provider])

    const res = await app.request('/api/v1/sessions/session-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed' }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { session: Session }
    expect(body.session.title).toBe('Renamed')
  })

  it('删掉一个会话', async () => {
    const provider = new FakeAgentProvider({ sessions: [makeSession()] })
    const { app } = createApp([provider])

    const res = await app.request('/api/v1/sessions/session-1', { method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: true, id: 'session-1' })
    expect(provider.sessions).toHaveLength(0)
  })

  it('读一个会话的消息', async () => {
    const provider = new FakeAgentProvider({ messages: { 'session-1': [makeMessage()] } })
    const { app } = createApp([provider])

    const res = await app.request('/api/v1/sessions/session-1/messages')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { messages: Array<{ id: string }> }
    expect(body.messages[0]?.id).toBe('message-1')
  })

  it('发一句话', async () => {
    const provider = new FakeAgentProvider()
    const { app } = createApp([provider])

    const res = await app.request('/api/v1/sessions/session-1/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'do it' }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ accepted: true })
    expect(provider.calls.some((call) => call.method === 'sendPrompt')).toBe(true)
  })

  it('空话不算一句话', async () => {
    const provider = new FakeAgentProvider()
    const { app } = createApp([provider])

    const res = await app.request('/api/v1/sessions/session-1/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    })

    expect(res.status).toBe(400)
  })

  it('叫停一个会话', async () => {
    const provider = new FakeAgentProvider()
    const { app } = createApp([provider])

    const res = await app.request('/api/v1/sessions/session-1/abort', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(provider.calls.some((call) => call.method === 'abortSession')).toBe(true)
  })

  it('agent 用不了的时候，是 503，而且说的是用不了', async () => {
    const provider = new FakeAgentProvider()
    provider.failWith = new ProviderUnavailableError('alpha', 'The agent is starting')
    const { app } = createApp([provider])

    const res = await app.request('/api/v1/sessions')

    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('agent_unavailable')
  })

  it('agent 答出一个不合形状的东西时，这道门要关上', async () => {
    const broken = { id: 'session-1', title: 'no agent, no shape' } as unknown as Session
    const provider = new FakeAgentProvider({ sessions: [broken] })
    const { app } = createApp([provider])

    const res = await app.request('/api/v1/sessions')

    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('internal_error')
  })

  it('换一句话也能用：换一个 agent 答话', async () => {
    const alpha = new FakeAgentProvider({ id: 'alpha', sessions: [makeSession({ id: 'from-alpha' })] })
    const beta = new FakeAgentProvider({ id: 'beta', sessions: [makeSession({ id: 'from-beta' })] })
    const registry = new ProviderRegistry()
    registry.register(alpha, { default: true })
    registry.register(beta)
    const app = new Hono()
    app.route(
      '/api/v1',
      createApiV1Routes(registry, { name: 'opencode-manager', version: async () => '1', auth: signedIn }),
    )

    const res = await app.request('/api/v1/sessions?agent=beta')

    const body = (await res.json()) as { sessions: Session[] }
    expect(body.sessions[0]?.id).toBe('from-beta')
  })

  it('挂上去以后，地址就是 /api/v1', async () => {
    const registry = new ProviderRegistry()
    registry.register(new FakeAgentProvider({ id: 'alpha' }), { default: true })
    const protectedApi = new Hono()
    protectedApi.route(
      '/v1',
      createApiV1Routes(registry, { name: 'opencode-manager', version: async () => '1', auth: signedIn }),
    )
    const app = new Hono()
    app.route('/api', protectedApi)

    const res = await app.request('/api/v1/agents')

    expect(res.status).toBe(200)
    expect(((await res.json()) as { agents: unknown[] }).agents).toHaveLength(1)
  })

  it('没登录的时候，闸门说的是 v1 的话', async () => {
    const registry = new ProviderRegistry()
    registry.register(new FakeAgentProvider({ id: 'alpha' }), { default: true })
    const app = new Hono()
    app.route(
      '/api/v1',
      createApiV1Routes(registry, { name: 'opencode-manager', version: async () => '1', auth: signedOut }),
    )

    const res = await app.request('/api/v1/agents')

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: { code: 'unauthorized', message: 'No session' },
    })
  })

  it('闸门排在前面的时候，说不的是它', async () => {
    const registry = new ProviderRegistry()
    registry.register(new FakeAgentProvider({ id: 'alpha' }), { default: true })
    const app = new Hono()
    // The versioned API is registered first, the way the server registers it:
    // its own gate is the one that answers, and the other gate never gets
    // the chance to say no in a different shape.
    app.route(
      '/api/v1',
      createApiV1Routes(registry, { name: 'opencode-manager', version: async () => '1', auth: signedOut }),
    )
    const protectedApi = new Hono()
    protectedApi.use('/*', createAuthMiddleware(signedOut))
    app.route('/api', protectedApi)

    const res = await app.request('/api/v1/agents')

    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code?: string } }
    expect(body.error?.code).toBe('unauthorized')
  })
})
