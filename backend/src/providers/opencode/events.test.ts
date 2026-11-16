import { describe, expect, it } from 'vitest'
import { toVersionedEvent } from './events'

/**
 * The event stream, said in the versioned dialect.
 *
 * The stream is the one place where the agent's own words travel, so the
 * conversation's events are translated - by the same translator that says the
 * conversation over HTTP. Everything that is not about the shape of a
 * conversation is left as the agent says it.
 *
 * What the agent is waiting for is about the conversation too: the client
 * asks for those over HTTP and watches them change over the stream, so both
 * answers are the versioned ones.
 */
describe('事件流也用版本化的方言说话', () => {
  it('会话变了：变的是版本化的会话', () => {
    const event = toVersionedEvent({
      type: 'session.updated',
      properties: {
        info: {
          id: 'ses_1',
          projectID: 'proj_1',
          title: 'Hello',
          directory: '/work',
          time: { created: 10, updated: 20 },
        },
      },
    })

    expect(event).toEqual({
      type: 'session.updated',
      properties: {
        session: {
          id: 'ses_1',
          agentId: 'opencode',
          title: 'Hello',
          directory: '/work',
          workspaceId: null,
          parentId: null,
          createdAt: 10,
          updatedAt: 20,
          archived: false,
          status: 'unknown',
          revert: null,
          share: null,
        },
      },
    })
  })

  it('消息变了：变的是版本化的消息', () => {
    const event = toVersionedEvent({
      type: 'message.updated',
      properties: {
        info: {
          id: 'msg_1',
          sessionID: 'ses_1',
          role: 'assistant',
          time: { created: 100, completed: 200 },
          modelID: 'claude',
          providerID: 'anthropic',
        },
      },
    })

    expect(event).toMatchObject({
      type: 'message.updated',
      properties: {
        message: {
          id: 'msg_1',
          sessionId: 'ses_1',
          role: 'assistant',
          createdAt: 100,
          completedAt: 200,
          modelId: 'claude',
          providerId: 'anthropic',
        },
      },
    })
  })

  it('片段变了：变的是版本化的片段', () => {
    const event = toVersionedEvent({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'prt_1',
          sessionID: 'ses_1',
          messageID: 'msg_1',
          type: 'text',
          text: 'hi',
        },
      },
    })

    expect(event).toEqual({
      type: 'message.part.updated',
      properties: {
        sessionId: 'ses_1',
        messageId: 'msg_1',
        part: { id: 'prt_1', type: 'text', text: 'hi', synthetic: null, time: null },
      },
    })
  })

  it('片段多了一段：多的是版本化的增量', () => {
    const event = toVersionedEvent({
      type: 'message.part.delta',
      properties: {
        sessionID: 'ses_1',
        messageID: 'msg_1',
        partID: 'prt_1',
        field: 'text',
        delta: ' more',
      },
    })

    expect(event).toEqual({
      type: 'message.part.delta',
      properties: {
        sessionId: 'ses_1',
        messageId: 'msg_1',
        partId: 'prt_1',
        field: 'text',
        delta: ' more',
      },
    })
  })

  it('会话失败了：说的是版本化的失败', () => {
    const event = toVersionedEvent({
      type: 'session.error',
      properties: {
        sessionID: 'ses_1',
        error: { name: 'ProviderAuthError', data: { message: 'no key', providerID: 'anthropic' } },
      },
    })

    expect(event).toEqual({
      type: 'session.error',
      properties: {
        sessionId: 'ses_1',
        error: {
          kind: 'authentication',
          message: 'no key',
          providerId: 'anthropic',
          statusCode: null,
          isRetryable: false,
        },
      },
    })
  })

  it('会话有多忙：说的是版本化的状态', () => {
    // The client is told about a status on the stream and asks for it over
    // HTTP, and the two answers have to be the same words - so the status is
    // said in the versioned dialect here too.
    expect(
      toVersionedEvent({
        type: 'session.status',
        properties: { sessionID: 'ses_1', status: { type: 'busy' } },
      }),
    ).toEqual({
      type: 'session.status',
      properties: { sessionId: 'ses_1', status: { type: 'busy' } },
    })

    expect(
      toVersionedEvent({
        type: 'session.status',
        properties: {
          sessionID: 'ses_1',
          status: { type: 'retry', attempt: 2, message: 'the upstream said no', next: 5000 },
        },
      }),
    ).toEqual({
      type: 'session.status',
      properties: {
        sessionId: 'ses_1',
        status: { type: 'retry', attempt: 2, message: 'the upstream said no', next: 5000 },
      },
    })
  })

  it('读不懂的状态被丢掉，不给客户端半句', () => {
    expect(
      toVersionedEvent({
        type: 'session.status',
        properties: { sessionID: 'ses_1', status: { type: 'retry', attempt: 2 } },
      }),
    ).toBeNull()
  })

  it('待办变了：变的是版本化的待办', () => {
    const event = toVersionedEvent({
      type: 'todo.updated',
      properties: {
        sessionID: 'ses_1',
        todos: [
          { content: 'write it', status: 'pending', priority: 'high' },
        ],
      },
    })

    expect(event).toEqual({
      type: 'todo.updated',
      properties: {
        sessionId: 'ses_1',
        todos: [
          { content: 'write it', status: 'pending', priority: 'high' },
        ],
      },
    })
  })

  it('agent 自己的规格说待办有名字，方言不跟着说', () => {
    // The agent's specification says a task carries an id. The agent that is
    // running does not send one, so the dialect does not repeat a promise
    // nobody made - and if one ever arrives, it is not passed through as
    // something this layer knows.
    const event = toVersionedEvent({
      type: 'todo.updated',
      properties: {
        sessionID: 'ses_1',
        todos: [
          { id: 'todo_1', content: 'write it', status: 'pending', priority: 'high' },
        ],
      },
    })

    expect(event).toEqual({
      type: 'todo.updated',
      properties: {
        sessionId: 'ses_1',
        todos: [
          { content: 'write it', status: 'pending', priority: 'high' },
        ],
      },
    })
  })

  it('待办里没有字的那一条被丢掉，其余的还在', () => {
    // A task without words cannot be drawn and cannot be told apart from
    // another one. The rest of the list is still worth saying.
    const event = toVersionedEvent({
      type: 'todo.updated',
      properties: {
        sessionID: 'ses_1',
        todos: [
          { status: 'pending', priority: 'high' },
          { content: 'ship it', status: 'completed', priority: 'low' },
        ],
      },
    })

    expect(event).toEqual({
      type: 'todo.updated',
      properties: {
        sessionId: 'ses_1',
        todos: [
          { content: 'ship it', status: 'completed', priority: 'low' },
        ],
      },
    })
  })

  it('要许可：许可就是客户端去问时拿到的那个形状', () => {
    const event = toVersionedEvent({
      type: 'permission.asked',
      properties: {
        id: 'per_1',
        sessionID: 'ses_1',
        permission: 'bash',
        patterns: ['echo hello'],
        metadata: {},
        always: [],
        tool: { messageID: 'msg_1', callID: 'call_1' },
      },
    }, '/work')

    expect(event).toEqual({
      type: 'permission.asked',
      properties: {
        sessionId: 'ses_1',
        permission: {
          id: 'per_1',
          sessionId: 'ses_1',
          directory: '/work',
          permission: 'bash',
          patterns: ['echo hello'],
          metadata: {},
          always: [],
          tool: { messageId: 'msg_1', callId: 'call_1' },
        },
      },
    })
  })

  it('许可答了：答的是版本化的那一句', () => {
    expect(
      toVersionedEvent({
        type: 'permission.replied',
        properties: { sessionID: 'ses_1', requestID: 'per_1', reply: 'once' },
      }),
    ).toEqual({
      type: 'permission.replied',
      properties: { sessionId: 'ses_1', requestId: 'per_1', reply: 'once' },
    })
  })

  it('要提问：提问也是客户端去问时拿到的那个形状', () => {
    const event = toVersionedEvent({
      type: 'question.asked',
      properties: {
        id: 'q_1',
        sessionID: 'ses_1',
        questions: [
          {
            question: 'Continue?',
            header: 'Confirm',
            options: [{ label: 'Yes', description: 'Continue' }],
            multiple: false,
          },
        ],
      },
    }, '/work')

    expect(event).toEqual({
      type: 'question.asked',
      properties: {
        sessionId: 'ses_1',
        question: {
          id: 'q_1',
          sessionId: 'ses_1',
          directory: '/work',
          questions: [
            {
              question: 'Continue?',
              header: 'Confirm',
              options: [{ label: 'Yes', description: 'Continue' }],
              multiple: false,
            },
          ],
          tool: null,
        },
      },
    })
  })

  it('提问答了或者被拒了：说的还是那一个请求', () => {
    expect(
      toVersionedEvent({
        type: 'question.replied',
        properties: { sessionID: 'ses_1', requestID: 'q_1', answers: [['Yes']] },
      }),
    ).toEqual({
      type: 'question.replied',
      properties: { sessionId: 'ses_1', requestId: 'q_1', answers: [['Yes']] },
    })

    expect(
      toVersionedEvent({
        type: 'question.rejected',
        properties: { sessionID: 'ses_1', requestID: 'q_1' },
      }),
    ).toEqual({
      type: 'question.rejected',
      properties: { sessionId: 'ses_1', requestId: 'q_1' },
    })
  })

  it('答不上来的许可被丢掉，不给客户端半句', () => {
    // A permission with no id cannot be said - the list over HTTP refuses one
    // like this too. A stream that carried it would leave the client holding
    // a permission it cannot answer.
    expect(
      toVersionedEvent({
        type: 'permission.asked',
        properties: { sessionID: 'ses_1', permission: 'bash' },
      }),
    ).toBeNull()
  })

  it('不是对话的事，就照 agent 的原话传过去', () => {
    const installed = {
      type: 'installation.updated',
      properties: { version: '1.2.3' },
    }

    expect(toVersionedEvent(installed)).toEqual(installed)
  })

  it('读不懂的对话事件被丢掉，不把半句对话交给客户端', () => {
    // A message event with no message in it cannot be said in the versioned
    // dialect. Handing on the agent's half of it would put two dialects in one
    // stream - which is the thing the translation exists to prevent.
    expect(
      toVersionedEvent({
        type: 'message.updated',
        properties: { info: { role: 'assistant' } },
      }),
    ).toBeNull()

    expect(
      toVersionedEvent({
        type: 'message.part.delta',
        properties: { sessionID: 'ses_1' },
      }),
    ).toBeNull()
  })

  it('不是事件的东西，就不是事件', () => {
    expect(toVersionedEvent(null)).toBeNull()
    expect(toVersionedEvent('hello')).toBe('hello')
    expect(toVersionedEvent({ type: 'message.updated' })).toEqual({ type: 'message.updated' })
  })
})
