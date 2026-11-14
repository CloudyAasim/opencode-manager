import { describe, expect, it, vi } from 'vitest'
import { UpstreamError, type OpenCodeClient } from '../../services/opencode/client'
import { ProviderProtocolError, ProviderUpstreamError, SessionNotFoundError } from '../contract'
import {
  OpenCodeProvider,
  toAgentDefaults,
  toCommand,
  toMessage,
  toMessageWithParts,
  toPart,
  toSession,
  toWorkingMode,
} from './adapter'

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
      share: null,
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

  it('会话：共享链接照原样翻译过来', () => {
    const session = toSession(
      { id: 'ses_1', share: { url: 'https://example.com/s/abc' } },
      'opencode',
    )

    expect(session.share).toEqual({ url: 'https://example.com/s/abc' })
  })

  it('会话：没有共享链接就说没有，不是不存在这个字段', () => {
    const session = toSession({ id: 'ses_1' }, 'opencode')

    expect(session.share).toBeNull()
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
    const raw = {
      info: {
        id: 'msg_1',
        sessionID: 'ses_1',
        role: 'assistant',
        time: { created: 100, completed: 200 },
        cost: 0.5,
        tokens: { input: 10, output: 20, reasoning: 5, cache: { read: 1, write: 2 } },
        modelID: 'claude',
        providerID: 'anthropic',
        agent: 'build',
        variant: 'v1',
      },
      parts: [{ id: 'prt_1', type: 'text', text: 'hi' }],
    }

    expect(toMessage(raw, 'opencode')).toEqual({
      id: 'msg_1',
      sessionId: 'ses_1',
      role: 'assistant',
      createdAt: 100,
      completedAt: 200,
      cost: 0.5,
      tokens: { input: 10, output: 20, reasoning: 5, cacheRead: 1, cacheWrite: 2 },
      modelId: 'claude',
      providerId: 'anthropic',
      agent: 'build',
      variant: 'v1',
      parentId: null,
      error: null,
    })

    expect(toMessageWithParts(raw, 'opencode')).toEqual({
      info: toMessage(raw, 'opencode'),
      parts: [{ id: 'prt_1', type: 'text', text: 'hi', synthetic: null, time: null }],
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
      synthetic: null,
      time: null,
    })

    expect(toPart({ id: 'p2', type: 'reasoning', text: 'thinking' })).toEqual({
      id: 'p2',
      type: 'reasoning',
      text: 'thinking',
      time: null,
    })

    expect(toPart({ id: 'p3', type: 'tool', tool: 'bash', state: { status: 'completed', title: 'ls' } })).toEqual({
      id: 'p3',
      type: 'tool',
      callId: '',
      name: 'bash',
      state: {
        status: 'completed',
        title: 'ls',
        output: null,
        error: null,
        input: null,
        metadata: null,
        raw: null,
        time: null,
      },
    })

    expect(toPart({ id: 'p4', type: 'file', filename: 'a.txt' })).toEqual({
      id: 'p4',
      type: 'file',
      filename: 'a.txt',
      mime: null,
      url: '',
    })
  })

  it('片段：看不懂的片段不许被丢掉，也不许被当成文字', () => {
    const part = toPart({ id: 'p5', type: 'mystery', text: 'what' })

    // The words are kept - dropping a piece of the answer loses part of it -
    // but the kind is not 'text', so nothing on the screen draws it as the
    // message's text.
    expect(part).toEqual({ id: 'p5', type: 'other', text: 'what' })
    expect(part.type).not.toBe('text')
  })

  it('片段：工具还没开始就是 pending', () => {
    expect(toPart({ id: 'p6', type: 'tool', tool: 'bash', state: { status: 'pending' } })).toEqual({
      id: 'p6',
      type: 'tool',
      callId: '',
      name: 'bash',
      state: {
        status: 'pending',
        title: null,
        output: null,
        error: null,
        input: null,
        metadata: null,
        raw: null,
        time: null,
      },
    })
  })

  it('片段：子会话的 id 在工具自己身上还是在状态里，都读得到', () => {
    // The agent puts the conversation a task handed off to in one place or the
    // other, and the versioned shape has one place for it - so both are read
    // into it, and the client does not have to know which one the agent used.
    const onThePart = toPart({
      id: 'p7',
      type: 'tool',
      tool: 'task',
      metadata: { sessionId: 'child-session' },
      state: { status: 'completed', output: 'done' },
    })
    expect(onThePart.type === 'tool' ? onThePart.state.metadata : null).toEqual({
      sessionId: 'child-session',
    })

    const inTheState = toPart({
      id: 'p8',
      type: 'tool',
      tool: 'task',
      state: { status: 'completed', output: 'done', metadata: { sessionId: 'child-session' } },
    })
    expect(inTheState.type === 'tool' ? inTheState.state.metadata : null).toEqual({
      sessionId: 'child-session',
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

    await provider.sendPrompt(
      'ses_1',
      { parts: [{ type: 'text', text: 'do it' }], model: null, agent: null, variant: null },
      {},
    )

    expect(forward).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/session/ses_1/prompt_async',
        body: JSON.stringify({ parts: [{ type: 'text', text: 'do it' }] }),
      }),
    )
  })

  it('发提示词时，模型、agent 和变体都照原样送到', async () => {
    const forward = vi.fn(async () => new Response('', { status: 200 }))
    const provider = new OpenCodeProvider(clientWith({ forward }))

    await provider.sendPrompt(
      'ses_1',
      {
        parts: [
          { type: 'text', text: 'do it' },
          { type: 'file', filename: 'note.txt', mime: 'text/plain', url: 'file:///tmp/note.txt' },
        ],
        model: { providerId: 'anthropic', modelId: 'claude' },
        agent: 'build',
        variant: 'v1',
      },
      {},
    )

    expect(forward).toHaveBeenCalledWith(
      expect.objectContaining({
        body: JSON.stringify({
          parts: [
            { type: 'text', text: 'do it' },
            { type: 'file', mime: 'text/plain', filename: 'note.txt', url: 'file:///tmp/note.txt' },
          ],
          model: { providerID: 'anthropic', modelID: 'claude' },
          agent: 'build',
          variant: 'v1',
        }),
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

describe('agent 自己那张脸，翻译成版本化的话', () => {
  it('命令：上游的话变成版本化 API 的话', () => {
    expect(
      toCommand({
        name: 'init',
        description: 'start the project',
        agent: 'build',
        model: 'anthropic/claude',
        mcp: true,
        template: 'set the project up',
        subtask: true,
        hints: ['repository'],
      }),
    ).toEqual({
      name: 'init',
      description: 'start the project',
      workingMode: 'build',
      model: { providerId: 'anthropic', modelId: 'claude' },
      template: 'set the project up',
      subtask: true,
      hints: ['repository'],
    })
  })

  it('命令：模型写成两个字段也读得出来', () => {
    expect(toCommand({ name: 'init', model: { providerID: 'anthropic', modelID: 'claude' } }).model).toEqual(
      { providerId: 'anthropic', modelId: 'claude' },
    )
  })

  it('命令：读不出来的模型就是没有模型，不许编一个出来', () => {
    expect(toCommand({ name: 'init', model: 'claude' }).model).toBeNull()
  })

  it('命令：上游没说的东西不许被编出来', () => {
    expect(toCommand({ name: 'init', template: '' })).toEqual({
      name: 'init',
      description: null,
      workingMode: null,
      model: null,
      template: '',
      subtask: false,
      hints: [],
    })
  })

  it('命令：没有名字的回答是答错了，不是空的', () => {
    expect(() => toCommand({ description: 'nameless' })).toThrow(ProviderProtocolError)
  })

  it('工作方式：上游的三种说法都读得出来', () => {
    expect(toWorkingMode({ name: 'build', mode: 'primary' }).scope).toBe('primary')
    expect(toWorkingMode({ name: 'review', mode: 'subagent' }).scope).toBe('subagent')
    expect(toWorkingMode({ name: 'both', mode: 'all' }).scope).toBe('all')
  })

  it('工作方式：看不懂的说法也照给，宁可多给不可少给', () => {
    expect(toWorkingMode({ name: 'new', mode: 'something-else' }).scope).toBe('all')
  })

  it('工作方式：没有名字的回答是答错了', () => {
    expect(() => toWorkingMode({ mode: 'primary' })).toThrow(ProviderProtocolError)
  })

  it('工作方式：它偏好的模型跟着它一起出来', () => {
    expect(toWorkingMode({ name: 'build', model: { providerID: 'anthropic', modelID: 'claude' } }).model)
      .toEqual({ providerId: 'anthropic', modelId: 'claude' })
    expect(toWorkingMode({ name: 'build' }).model).toBeNull()
  })

  it('默认值：模型写成一行字也读得出来', () => {
    expect(toAgentDefaults({ model: 'anthropic/claude', default_agent: 'build' })).toEqual({
      model: { providerId: 'anthropic', modelId: 'claude' },
      workingMode: 'build',
    })
  })

  it('默认值：模型写成两个字段也读得出来', () => {
    expect(toAgentDefaults({ model: { providerID: 'anthropic', modelID: 'claude' } })).toEqual({
      model: { providerId: 'anthropic', modelId: 'claude' },
      workingMode: null,
    })
  })

  it('默认值：模型名里带斜杠的，斜杠前面那段才是 provider', () => {
    expect(toAgentDefaults({ model: 'openrouter/anthropic/claude-3.5' }).model).toEqual({
      providerId: 'openrouter',
      modelId: 'anthropic/claude-3.5',
    })
  })

  it('默认值：什么都没说的，就是没有默认', () => {
    expect(toAgentDefaults({})).toEqual({ model: null, workingMode: null })
  })

  it('命令列表：问的是上游的命令那条路', async () => {
    const getJson = vi.fn(async () => [] as unknown)
    const provider = new OpenCodeProvider(clientWith({ getJson }))

    await provider.listCommands({ directory: '/work' })

    expect(getJson).toHaveBeenCalledWith('/command', { directory: '/work' })
  })

  it('跑命令：命令、参数、工作方式和模型都照原样送到', async () => {
    const forward = vi.fn(async () => new Response('{}', { status: 200 }))
    const provider = new OpenCodeProvider(clientWith({ forward }))

    await provider.sendCommand(
      'ses_1',
      {
        command: 'init',
        arguments: 'now',
        workingMode: 'build',
        model: { providerId: 'anthropic', modelId: 'claude' },
      },
      { directory: '/work' },
    )

    expect(forward).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/session/ses_1/command',
        body: JSON.stringify({
          command: 'init',
          arguments: 'now',
          agent: 'build',
          model: 'anthropic/claude',
        }),
      }),
    )
  })

  it('摘要：写摘要的模型按上游的写法送到', async () => {
    const forward = vi.fn(async () => new Response('{}', { status: 200 }))
    const provider = new OpenCodeProvider(clientWith({ forward }))

    await provider.summarizeSession(
      'ses_1',
      { providerId: 'anthropic', modelId: 'claude' },
      { directory: '/work' },
    )

    expect(forward).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/session/ses_1/summarize',
        body: JSON.stringify({ providerID: 'anthropic', modelID: 'claude' }),
      }),
    )
  })

  it('副本：拷出来的会话是版本化的会话', async () => {
    const forward = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ id: 'ses_2', title: 'A copy', time: { created: 1, updated: 2 } }),
          { status: 200 },
        ),
    )
    const provider = new OpenCodeProvider(clientWith({ forward }))

    const forked = await provider.forkSession('ses_1', { messageId: 'msg_1' }, { directory: '/work' })

    expect(forked.id).toBe('ses_2')
    expect(forked.agentId).toBe('opencode')
    expect(forked.directory).toBe('/work')
    expect(forward).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/session/ses_1/fork',
        body: JSON.stringify({ messageID: 'msg_1' }),
      }),
    )
  })

  it('shell：没点名工作方式时，用 agent 自己的那个', async () => {
    const forward = vi.fn(async () => new Response('{}', { status: 200 }))
    const provider = new OpenCodeProvider(clientWith({ forward }))

    await provider.sendShell('ses_1', { command: 'ls -la', workingMode: null }, { directory: '/work' })

    expect(forward).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/session/ses_1/shell',
        body: JSON.stringify({ command: 'ls -la', agent: 'general' }),
      }),
    )
  })

  it('工作方式和默认值：问的是上游自己的那两条路', async () => {
    const getJson = vi.fn(async (path: string) => (path === '/agent' ? [] : {}) as unknown)
    const provider = new OpenCodeProvider(clientWith({ getJson }))

    await provider.listWorkingModes({ directory: '/work' })
    await provider.getDefaults({ directory: '/work' })

    expect(getJson).toHaveBeenCalledWith('/agent', { directory: '/work' })
    expect(getJson).toHaveBeenCalledWith('/config', { directory: '/work' })
  })
})
