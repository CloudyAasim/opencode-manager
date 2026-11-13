import { describe, expect, it } from 'vitest'
import { toVersionedEvent } from './events'

/**
 * The event stream, said in the versioned dialect.
 *
 * The stream is the one place where the agent's own words travel, so the
 * conversation's events are translated - by the same translator that says the
 * conversation over HTTP. Everything that is not about the shape of a
 * conversation is left as the agent says it.
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

  it('不是对话的事，就照 agent 的原话传过去', () => {
    const todo = {
      type: 'todo.updated',
      properties: { sessionID: 'ses_1', todos: [{ content: 'write it', status: 'pending' }] },
    }

    expect(toVersionedEvent(todo)).toEqual(todo)

    const status = {
      type: 'session.status',
      properties: { sessionID: 'ses_1', status: { type: 'busy' } },
    }

    expect(toVersionedEvent(status)).toEqual(status)
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
