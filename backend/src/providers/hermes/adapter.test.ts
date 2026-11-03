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

    const sessions = await provider.listSessions({})

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toEqual({
      id: 'sess_1',
      agentId: 'hermes',
      title: 'Fixing the parser',
      directory: '/work/demo',
      parentId: null,
      createdAt: 1000,
      updatedAt: 2000,
      archived: false,
      status: 'idle',
    })
  })

  it('列表装在别的地方也读得出来', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([{ session_id: 'sess_2', title: 'Direct' }]))
    const provider = new HermesProvider({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch })

    const sessions = await provider.listSessions({})

    expect(sessions[0]?.id).toBe('sess_2')
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
})
