import { describe, expect, it, vi } from 'vitest'
import { HermesProvider } from './adapter'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Hermes', () => {
  it('没有 API server 的钥匙，就说不通', async () => {
    const provider = new HermesProvider({ apiKey: '' })

    const status = await provider.status()

    expect(status.status).toBe('unavailable')
    expect(status.detail).toContain('key')
  })

  it('API server 答了话，就是通的', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ features: {} }))
    const provider = new HermesProvider({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch })

    const status = await provider.status()

    expect(status.status).toBe('ready')
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:8642/v1/capabilities',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer k' }),
      }),
    )
  })

  it('会话列表读出来就是会话列表', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        sessions: [
          {
            id: 'sess_1',
            title: 'Fixing the parser',
            cwd: '/work/demo',
            started_at: 1000,
            ended_at: 2000,
          },
        ],
      }),
    )
    const provider = new HermesProvider({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch })

    const page = await provider.listSessions({})

    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toEqual({
      id: 'sess_1',
      agentId: 'hermes',
      title: 'Fixing the parser',
      directory: '/work/demo',
      workspaceId: null,
      parentId: null,
      createdAt: 1000,
      updatedAt: 2000,
      archived: false,
      status: 'idle',
    })
    expect(page.nextCursor).toBeNull()
  })

  it('列表装在别的地方也读得出来', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([{ session_id: 'sess_2', title: 'Direct' }]))
    const provider = new HermesProvider({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch })

    const page = await provider.listSessions({})

    expect(page.items[0]?.id).toBe('sess_2')
  })

  it('消息读出来就是消息', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        messages: [
          { id: 'm1', role: 'user', content: 'hello', timestamp: 5 },
          {
            id: 'm2',
            role: 'assistant',
            content: [{ type: 'text', text: 'hi' }],
            timestamp: 6,
          },
        ],
      }),
    )
    const provider = new HermesProvider({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch })

    const messages = await provider.listMessages('sess_1', {})

    expect(messages).toHaveLength(2)
    expect(messages[0]?.role).toBe('user')
    expect(messages[1]?.parts[0]?.text).toBe('hi')
  })

  it('发一句话，是用 OpenAI 那套形状发的', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'chatcmpl-1' }))
    const provider = new HermesProvider({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch })

    await provider.sendPrompt('sess_1', { text: 'do it' }, {})

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8642/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'hermes-agent',
      messages: [{ role: 'user', content: 'do it' }],
    })
    expect((init.headers as Record<string, string>)['X-Hermes-Session-Id']).toBe('sess_1')
  })

  it('服务器答不上来，就是答不上来', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 }))
    const provider = new HermesProvider({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch })

    await expect(provider.listSessions({})).rejects.toThrow('503')
  })

  it('会话是裹在信封里的', async () => {
    // The shape a real Hermes answers with: the session is inside an
    // envelope, and a list of them is a list of the inner thing.
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        object: 'hermes.session',
        session: {
          id: 'api_1793846853_0850a3e9',
          source: 'api_server',
          title: 'Adapter check',
          started_at: 1793846853.8952541,
          ended_at: null,
          parent_session_id: null,
          archived: false,
        },
      }),
    )
    const provider = new HermesProvider({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch })

    const session = await provider.createSession({ title: 'Adapter check' })

    expect(session.id).toBe('api_1793846853_0850a3e9')
    expect(session.title).toBe('Adapter check')
    expect(session.createdAt).toBeCloseTo(1793846853.895, 2)
  })

  it('消息的 id 是数字，角色也不总是那三个', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        object: 'list',
        session_id: 'api_1',
        data: [
          {
            id: 1,
            session_id: 'api_1',
            role: 'session_meta',
            content: null,
            tool_call_id: null,
            tool_calls: null,
            tool_name: null,
            timestamp: 1793846093.9920332,
          },
          {
            id: 2,
            session_id: 'api_1',
            role: 'assistant',
            content: 'here you go',
            tool_calls: '[{"id":"call_1","function":{"name":"bash","arguments":"{}"}}]',
            timestamp: 1793846094.1,
          },
        ],
        pagination: { limit: 500, offset: 0, order: 'latest', returned: 2 },
      }),
    )
    const provider = new HermesProvider({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch })

    const messages = await provider.listMessages('api_1', {})

    expect(messages).toHaveLength(2)
    expect(messages[0]?.id).toBe('1')
    expect(messages[0]?.role).toBe('system')
    expect(messages[1]?.parts[0]?.text).toBe('here you go')
    expect(messages[1]?.parts[1]?.tool?.name).toBe('bash')
  })

  it('服务端说的话要带出来', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ detail: 'a session with this title already exists' }, 400),
    )
    const provider = new HermesProvider({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch })

    await expect(provider.createSession({ title: 'Adapter check' })).rejects.toThrow(
      'a session with this title already exists',
    )
  })
})
