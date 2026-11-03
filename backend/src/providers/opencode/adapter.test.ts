import { describe, expect, it, vi } from 'vitest'
import { UpstreamError, type OpenCodeClient } from '../../services/opencode/client'
import { ProviderProtocolError, SessionNotFoundError } from '../contract'
import { OpenCodeProvider, toMessage, toPart, toSession } from './adapter'

function clientWith(overrides: Record<string, unknown>): OpenCodeClient {
  return {
    forward: vi.fn(async () => new Response('{}', { status: 200 })),
    forwardRaw: vi.fn(async () => new Response('{}', { status: 200 })),
    getJson: vi.fn(async () => ({}) as unknown),
    postJson: vi.fn(async () => ({}) as unknown),
    setProviderAuth: vi.fn(async () => true),
    deleteProviderAuth: vi.fn(async () => true),
    ...overrides,
  } as unknown as OpenCodeClient
}

describe('OpenCode 的形状翻译成归一化的形状', () => {
  it('会话：上游的话变成版本化 API 的话', () => {
    const session = toSession(
      {
        id: 'ses_1',
        projectID: 'proj_1',
        directory: '/work',
        parentID: 'ses_0',
        title: 'Hello',
        version: 'v2',
        time: { created: 10, updated: 20, archived: 30 },
      },
      'opencode',
    )

    expect(session).toEqual({
      id: 'ses_1',
      agentId: 'opencode',
      title: 'Hello',
      directory: '/work',
      parentId: 'ses_0',
      createdAt: 10,
      updatedAt: 20,
      archived: true,
      status: 'unknown',
    })
  })

  it('会话：上游没说的东西不许被编出来', () => {
    const session = toSession({ id: 'ses_1' }, 'opencode')

    expect(session.title).toBe('')
    expect(session.directory).toBeNull()
    expect(session.parentId).toBeNull()
    expect(session.createdAt).toBe(0)
    expect(session.updatedAt).toBe(0)
    expect(session.archived).toBe(false)
  })

  it('会话：没有 id 的回答是答错了，不是空的', () => {
    expect(() => toSession({ title: 'no id' }, 'opencode')).toThrow(ProviderProtocolError)
  })

  it('消息：info 和 parts 合起来才是一条消息', () => {
    const message = toMessage(
      {
        info: {
          id: 'msg_1',
          sessionID: 'ses_1',
          role: 'assistant',
          time: { created: 100, completed: 200 },
          cost: 0.5,
          tokens: { input: 10, output: 20, reasoning: 5, cache: { read: 1, write: 2 } },
        },
        parts: [{ id: 'prt_1', type: 'text', text: 'hi' }],
      },
      'opencode',
    )

    expect(message).toEqual({
      id: 'msg_1',
      sessionId: 'ses_1',
      role: 'assistant',
      createdAt: 100,
      completedAt: 200,
      parts: [{ id: 'prt_1', type: 'text', text: 'hi', tool: null }],
      cost: 0.5,
      tokens: { input: 10, output: 20, reasoning: 5, cacheRead: 1, cacheWrite: 2 },
    })
  })

  it('消息：说不清是谁说的话就说 system', () => {
    const message = toMessage({ info: { id: 'msg_1', role: 'tool' } }, 'opencode')
    expect(message.role).toBe('system')
  })

  it('消息：没有 id 的回答是答错了', () => {
    expect(() => toMessage({ info: { role: 'user' } }, 'opencode')).toThrow(ProviderProtocolError)
  })

  it('片段：文字、想法、工具、文件各归各的', () => {
    expect(toPart({ id: 'p1', type: 'text', text: 'hello' })).toEqual({
      id: 'p1',
      type: 'text',
      text: 'hello',
      tool: null,
    })

    expect(toPart({ id: 'p2', type: 'reasoning', text: 'thinking' })).toEqual({
      id: 'p2',
      type: 'reasoning',
      text: 'thinking',
      tool: null,
    })

    expect(toPart({ id: 'p3', type: 'tool', tool: 'bash', state: { status: 'completed', title: 'ls' } })).toEqual({
      id: 'p3',
      type: 'tool',
      text: null,
      tool: { name: 'bash', state: 'completed', title: 'ls', output: null },
    })

    expect(toPart({ id: 'p4', type: 'file', filename: 'a.txt' })).toEqual({
      id: 'p4',
      type: 'file',
      text: 'a.txt',
      tool: null,
    })
  })

  it('片段：看不懂的片段不许被丢掉，也不许被当成文字', () => {
    expect(toPart({ id: 'p5', type: 'step-start' })).toEqual({
      id: 'p5',
      type: 'other',
      text: null,
      tool: null,
    })
  })

  it('片段：工具还没开始就是 pending', () => {
    expect(toPart({ id: 'p6', type: 'tool', tool: 'bash', state: { status: 'pending' } })).toEqual({
      id: 'p6',
      type: 'tool',
      text: null,
      tool: { name: 'bash', state: 'pending', title: null, output: null },
    })
  })
})

describe('OpenCode 适配器', () => {
  it('列会话时把每个会话的状态也问一遍', async () => {
    const getJson = vi.fn(async (path: string) => {
      if (path === '/session/status') return { ses_1: { type: 'busy' } }
      return [{ id: 'ses_1', title: 'One' }]
    })
    const provider = new OpenCodeProvider(clientWith({ getJson }))

    const sessions = await provider.listSessions({})

    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.status).toBe('busy')
  })

  it('问不到状态的时候，列会话不能跟着失败', async () => {
    const getJson = vi.fn(async (path: string) => {
      if (path === '/session/status') throw new Error('no status')
      return [{ id: 'ses_1' }]
    })
    const provider = new OpenCodeProvider(clientWith({ getJson }))

    const sessions = await provider.listSessions({})

    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.status).toBe('unknown')
  })

  it('工作目录要跟着请求一起走', async () => {
    const getJson = vi.fn(async () => [])
    const provider = new OpenCodeProvider(clientWith({ getJson }))

    await provider.listSessions({ directory: '/work' })

    expect(getJson).toHaveBeenCalledWith('/session', { directory: '/work' })
  })

  it('没有这样的会话就是没有，不是错误', async () => {
    const getJson = vi.fn(async () => {
      throw new UpstreamError(404, 'not found')
    })
    const provider = new OpenCodeProvider(clientWith({ getJson }))

    await expect(provider.getSession('ses_x', {})).resolves.toBeNull()
  })

  it('上游答不上来的时候，说的是上游答不上来', async () => {
    const getJson = vi.fn(async () => {
      throw new UpstreamError(500, 'boom')
    })
    const provider = new OpenCodeProvider(clientWith({ getJson }))

    await expect(provider.getSession('ses_x', {})).rejects.toThrow('The agent answered with 500')
  })

  it('发提示词发的是一段文字', async () => {
    const forward = vi.fn(async () => new Response('', { status: 200 }))
    const provider = new OpenCodeProvider(clientWith({ forward }))

    await provider.sendPrompt('ses_1', { text: 'do it' }, {})

    expect(forward).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/session/ses_1/prompt_async',
        body: JSON.stringify({ parts: [{ type: 'text', text: 'do it' }] }),
      }),
    )
  })

  it('删一个不存在的会话，是上游说没有', async () => {
    const forward = vi.fn(async () => new Response('not found', { status: 404 }))
    const provider = new OpenCodeProvider(clientWith({ forward }))

    await expect(provider.deleteSession('ses_x', {})).rejects.toThrow(SessionNotFoundError)
  })

  it('服务器没在跑的时候，它自己说没在跑', async () => {
    const provider = new OpenCodeProvider(clientWith({}), { isReady: () => false })
    await expect(provider.status()).resolves.toEqual({
      status: 'unavailable',
      detail: 'The OpenCode server is not running',
    })
  })

  it('它是谁、它会什么，写在适配器自己身上', () => {
    const provider = new OpenCodeProvider(clientWith({}))

    expect(provider.id).toBe('opencode')
    expect(provider.kind).toBe('server')
    expect(provider.capabilities).toContain('prompts')
  })
})
