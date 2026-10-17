import { QueryClient } from '@tanstack/react-query'
import { describe, it, expect } from 'vitest'
import { optimisticallyErrorToolPart } from './optimisticToolError'
import type { MessageWithParts } from '@/api/types'

const KEY = ['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo']

function runningToolMessage(messageID: string, callID: string): MessageWithParts {
  return {
    info: {
      id: messageID,
      sessionID: 'session-1',
      role: 'assistant',
      time: { created: 1 },
      parentID: '',
      modelID: 'm',
      providerID: 'p',
      mode: 'build',
      agent: 'a',
      path: { cwd: '/repo', root: '/repo' },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [
      { id: `${messageID}-text`, messageID, sessionID: 'session-1', type: 'text', text: 'working' },
      {
        id: `${messageID}-tool`,
        messageID,
        sessionID: 'session-1',
        type: 'tool',
        callID,
        tool: 'bash',
        state: { status: 'running', input: { command: 'ls' }, time: { start: 100 } },
      },
    ],
  } as unknown as MessageWithParts
}

function seed(queryClient: QueryClient, messages: MessageWithParts[]): void {
  queryClient.setQueryData(KEY, messages)
}

function toolState(queryClient: QueryClient, messageID: string) {
  const data = queryClient.getQueryData<MessageWithParts[]>(KEY) as MessageWithParts[]
  const msg = data.find(m => m.info.id === messageID)!
  const part = msg.parts.find(p => p.id === `${messageID}-tool`) as { state: { status: string; error?: string } }
  return part.state
}

describe('optimisticallyErrorToolPart', () => {
  // The user has already made the decision; without this the tool sits in
  // `running` until the server reports back, and the spinner keeps going.
  it('moves the matching running tool to errored', () => {
    const queryClient = new QueryClient()
    seed(queryClient, [runningToolMessage('msg-1', 'call-1')])

    optimisticallyErrorToolPart(queryClient, 'session-1', 'msg-1', 'call-1', 'Permission denied')

    expect(toolState(queryClient, 'msg-1').status).toBe('error')
    expect(toolState(queryClient, 'msg-1').error).toBe('Permission denied')
  })

  it('leaves a tool that already finished alone', () => {
    const queryClient = new QueryClient()
    const message = runningToolMessage('msg-1', 'call-1')
    ;(message.parts[1] as unknown as { state: { status: string } }).state = { status: 'completed', output: 'ok', time: { start: 100, end: 200 } }
    seed(queryClient, [message])

    optimisticallyErrorToolPart(queryClient, 'session-1', 'msg-1', 'call-1', 'Permission denied')

    expect(toolState(queryClient, 'msg-1').status).toBe('completed')
  })

  it('does not touch a tool with a different callID', () => {
    const queryClient = new QueryClient()
    seed(queryClient, [runningToolMessage('msg-1', 'call-1')])

    optimisticallyErrorToolPart(queryClient, 'session-1', 'msg-1', 'call-other', 'Permission denied')

    expect(toolState(queryClient, 'msg-1').status).toBe('running')
  })

  it('does not touch another session', () => {
    const queryClient = new QueryClient()
    seed(queryClient, [runningToolMessage('msg-1', 'call-1')])

    optimisticallyErrorToolPart(queryClient, 'session-other', 'msg-1', 'call-1', 'Permission denied')

    expect(toolState(queryClient, 'msg-1').status).toBe('running')
  })

  it('keeps the input and the start time it was running with', () => {
    const queryClient = new QueryClient()
    seed(queryClient, [runningToolMessage('msg-1', 'call-1')])

    optimisticallyErrorToolPart(queryClient, 'session-1', 'msg-1', 'call-1', 'Permission denied')

    const state = toolState(queryClient, 'msg-1') as unknown as { input: unknown; time: { start: number; end: number } }
    expect(state.input).toEqual({ command: 'ls' })
    expect(state.time.start).toBe(100)
    expect(state.time.end).toBeGreaterThanOrEqual(100)
  })

  /**
   * The function finds its target by key *position*, which is the fragile part:
   * if the messages query key is reordered or shortened, this loop finds
   * nothing and returns silently. The user then watches a tool spin forever
   * after having rejected it, with no error anywhere.
   *
   * So the key shape is pinned here, not just the behaviour.
   */
  it('still finds the query when an extra key segment is appended', () => {
    const queryClient = new QueryClient()
    const extended = [...KEY, 'extra']
    queryClient.setQueryData(extended, [runningToolMessage('msg-1', 'call-1')])

    optimisticallyErrorToolPart(queryClient, 'session-1', 'msg-1', 'call-1', 'Permission denied')

    const data = queryClient.getQueryData<MessageWithParts[]>(extended) as MessageWithParts[]
    const part = data[0]!.parts.find(p => p.id === 'msg-1-tool') as { state: { status: string } }
    expect(part.state.status).toBe('error')
  })

  it('does nothing when there is no cached messages query', () => {
    const queryClient = new QueryClient()
    expect(() =>
      optimisticallyErrorToolPart(queryClient, 'session-1', 'msg-1', 'call-1', 'Permission denied'),
    ).not.toThrow()
  })
})
