import { describe, expect, it, vi } from 'vitest'
import { UpstreamError, type OpenCodeClient } from '../../services/opencode/client'
import { ProviderProtocolError, ProviderUpstreamError, SessionNotFoundError } from '../contract'
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
      workspaceId: null,
      parentId: 'ses_0',
      createdAt: 10,
      updatedAt: 20,
      archived: true,
      status: 'unknown',
      revert: null,
    })
  })

  it('会话：回滚到了哪一条，上游说的就是哪一条', () => {
    const session = toSession(
      {
        id: 'ses_1',
        revert: { messageID: 'msg_1', partID: 'prt_1' },
      },
      'opencode',
    )

    expect(session.revert).toEqual({ messageId: 'msg_1', partId: 'prt_1' })
  })

  it('会话：回滚到了不是一条消息的地方，就当没有回滚过', () => {
    const session = toSession({ id: 'ses_1', revert: { partID: 'prt_1' } }, 'opencode')

    expect(session.revert).toBeNull()
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
      return { data: [{ id: 'ses_1', title: 'One' }] }
    })
    const provider = new OpenCodeProvider(clientWith({ getJson }))

    const page = await provider.listSessions({})

    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.status).toBe('busy')
  })

  it('问不到状态的时候，列会话不能跟着失败', async () => {
    const getJson = vi.fn(async (path: string) => {
      if (path === '/session/status') throw new Error('no status')
      return { data: [{ id: 'ses_1' }] }
    })
    const provider = new OpenCodeProvider(clientWith({ getJson }))

    const page = await provider.listSessions({})

    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.status).toBe('unknown')
  })

  it('工作目录要跟着请求一起走', async () => {
    const getJson = vi.fn(async () => ({ data: [] }))
    const provider = new OpenCodeProvider(clientWith({ getJson }))

    await provider.listSessions({ directory: '/work' })

    expect(getJson).toHaveBeenCalledWith('/api/session?order=desc', { directory: '/work' })
  })

  it('游标、条数、搜索都要原样交给上游', async () => {
    const getJson = vi.fn(async () => ({ data: [] }))
    const provider = new OpenCodeProvider(clientWith({ getJson }))

    await provider.listSessions({}, { limit: 25, cursor: 'cur_1', search: 'deploy' })

    expect(getJson).toHaveBeenCalledWith(
      '/api/session?order=desc&limit=25&cursor=cur_1&search=deploy',
      { directory: undefined },
    )
  })

  it('下一页的位置要照上游说的那样传回来', async () => {
    const getJson = vi.fn(async (path: string) => {
      if (path === '/session/status') return {}
      return { data: [{ id: 'ses_1' }], cursor: { next: 'cur_2' } }
    })
    const provider = new OpenCodeProvider(clientWith({ getJson }))

    const page = await provider.listSessions({})

    expect(page.nextCursor).toBe('cur_2')
  })

  it('没有下一页的时候要说没有，不能装作还有', async () => {
    const getJson = vi.fn(async (path: string) => {
      if (path === '/session/status') return {}
      return { data: [{ id: 'ses_1' }] }
    })
    const provider = new OpenCodeProvider(clientWith({ getJson }))

    const page = await provider.listSessions({})

    expect(page.nextCursor).toBeNull()
  })

  it('工作目录在新的形状里换了个位置，也照样读得出来', async () => {
    const getJson = vi.fn(async (path: string) => {
      if (path === '/session/status') return {}
      return { data: [{ id: 'ses_1', location: { directory: 'C:\\work\\demo' } }] }
    })
    const provider = new OpenCodeProvider(clientWith({ getJson }))

    const page = await provider.listSessions({})

    expect(page.items[0]?.directory).toBe('C:\\work\\demo')
  })

  it('会话的工作区没了的时候，删掉的是工作区', async () => {
    // The browser used to do this itself: it guessed from an error message
    // and it knew the working area's id because the conversation was on
    // screen. Here the id is read from the agent, and the words that mean
    // "the area is gone" are the agent's own.
    const forward = vi.fn(async (request: { method: string; path: string }) => {
      if (request.path.startsWith('/experimental/workspace/')) {
        return new Response('{}', { status: 200 })
      }
      return new Response('Workspace not found: wrk_1', { status: 500 })
    })
    const getJson = vi.fn(async () => ({ id: 'ses_1', workspaceID: 'wrk_1' }))
    const provider = new OpenCodeProvider(clientWith({ forward, getJson }))

    await provider.deleteSession('ses_1', { directory: '/work' })

    expect(forward).toHaveBeenCalledTimes(2)
    expect((forward.mock.calls[1]![0] as { path: string }).path).toBe('/experimental/workspace/wrk_1')
  })

  it('工作区也删不掉的时候，要说的是删不掉', async () => {
    const forward = vi.fn(async (request: { method: string; path: string }) => {
      if (request.path.startsWith('/experimental/workspace/')) {
        return new Response('nope', { status: 500 })
      }
      return new Response('Workspace not found: wrk_1', { status: 500 })
    })
    const getJson = vi.fn(async () => ({ id: 'ses_1', workspaceID: 'wrk_1' }))
    const provider = new OpenCodeProvider(clientWith({ forward, getJson }))

    await expect(provider.deleteSession('ses_1', {})).rejects.toThrow(ProviderUpstreamError)
  })

  it('删不掉的时候，不要顺手动别人的工作区', async () => {
    // The failure is not about a working area, so nothing else is touched:
    // removing a working area that was not the problem would throw away work
    // nobody asked to throw away.
    const forward = vi.fn(async () => new Response('nope', { status: 403 }))
    const getJson = vi.fn(async () => ({ id: 'ses_1', workspaceID: 'wrk_1' }))
    const provider = new OpenCodeProvider(clientWith({ forward, getJson }))

    await expect(provider.deleteSession('ses_1', {})).rejects.toThrow(ProviderUpstreamError)

    expect(forward).toHaveBeenCalledTimes(1)
    expect(getJson).not.toHaveBeenCalled()
  })

  it('上游没说会话是在哪儿写的，就用问的那个目录', async () => {
    const getJson = vi.fn(async (path: string) => {
      if (path === '/session/status') return {}
      return { data: [{ id: 'ses_1' }] }
    })
    const provider = new OpenCodeProvider(clientWith({ getJson }))

    const page = await provider.listSessions({ directory: '/work' })

    // 上游答的是"这个目录的会话"，所以会话就是这个目录的。没有地方的会话
    // 属于谁，是另一个答案。
    expect(page.items[0]?.directory).toBe('/work')
  })

  it('上游说了在哪儿，就不用问的那个目录盖过去', async () => {
    const getJson = vi.fn(async (path: string) => {
      if (path === '/session/status') return {}
      return { data: [{ id: 'ses_1', directory: '/elsewhere' }] }
    })
    const provider = new OpenCodeProvider(clientWith({ getJson }))

    const page = await provider.listSessions({ directory: '/work' })

    expect(page.items[0]?.directory).toBe('/elsewhere')
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
