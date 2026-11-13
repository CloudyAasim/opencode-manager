import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSSE } from './useSSE'
import { useSessionStatus } from '../stores/sessionStatusStore'
import { useSendErrorStore } from '../stores/sendErrorStore'
import { messagesQueryKey, sessionQueryKey } from '../lib/queryInvalidation'
import type { MessageWithParts, Session } from '@/api/types'
import { createTextPart } from '@/lib/partsBatcher'

const SERVER = 'http://localhost:5551'
const AGENT = 'http://localhost:5551'

const mocks = vi.hoisted(() => ({
  listStatuses: vi.fn(),
}))

// How busy everything is comes from the layer now, in the versioned dialect -
// the same words the event stream says them in.
vi.mock('@/api/bff', () => ({
  createBffClient: vi.fn(() => ({
    listStatuses: mocks.listStatuses,
  })),
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    reloadOpenCodeConfig: vi.fn(),
  },
}))

vi.mock('@/lib/toast', () => ({
  showToast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    success: vi.fn(),
  },
}))

class MockEventSource {
  static instances: MockEventSource[] = []

  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>()

  constructor() {
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  close() {}

  emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent
    this.listeners.get(type)?.forEach((listener) => listener(event))
    if (type === 'message' && this.onmessage) {
      this.onmessage(event)
    }
  }
}

/**
 * A message, in the versioned dialect.
 *
 * The event stream says the same thing in the same words the conversation is
 * read in, so the shapes here are the versioned ones.
 */
function assistantMessage(sessionID: string, messageID: string): MessageWithParts {
  return {
    info: {
      id: messageID,
      sessionId: sessionID,
      role: 'assistant',
      createdAt: Date.now(),
      completedAt: null,
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      modelId: 'test-model',
      providerId: 'test-provider',
      agent: 'test-agent',
      variant: null,
      parentId: null,
      error: null,
    },
    parts: [],
  }
}

/** A session, in the versioned dialect. */
function versionedSession(id: string, title: string): Session {
  return {
    id,
    agentId: 'test',
    title,
    directory: '/repo',
    workspaceId: null,
    parentId: null,
    createdAt: 1000,
    updatedAt: 2000,
    archived: false,
    status: 'idle',
    revert: null,
    share: null,
  }
}

describe('useSSE', () => {
  const originalEventSource = globalThis.EventSource
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    MockEventSource.instances = []
    mocks.listStatuses.mockResolvedValue({ statuses: {} })
    useSessionStatus.getState().replaceStatuses({})
    useSendErrorStore.setState({ errors: {}, queuedPrompts: {} })
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true } as Response))
  })

  afterEach(() => {
    useSessionStatus.getState().replaceStatuses({})
    useSendErrorStore.setState({ errors: {}, queuedPrompts: {} })
    globalThis.EventSource = originalEventSource
    globalThis.fetch = originalFetch
  })

  it('invalidates active session data after reconnecting', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result, unmount } = renderHook(
      () => useSSE(SERVER, AGENT, '/repo', 'session-1'),
      { wrapper }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))

    act(() => {
      MockEventSource.instances[0].emit('connected', { clientId: 'client-1' })
    })

    await waitFor(() => expect(result.current.isConnected).toBe(true))
    invalidateQueries.mockClear()

    act(() => {
      MockEventSource.instances[0].onerror?.()
    })

    await waitFor(() => expect(result.current.isConnected).toBe(false))

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2))

    act(() => {
      MockEventSource.instances[1].emit('connected', { clientId: 'client-2' })
    })

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: sessionQueryKey(SERVER, 'session-1', '/repo'),
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: messagesQueryKey(SERVER, 'session-1', '/repo'),
      })
    })

    unmount()
  })

  it('clears stale active statuses from the initial status snapshot', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    useSessionStatus.getState().setStatus('session-1', { type: 'busy' })

    const { unmount } = renderHook(
      () => useSSE(SERVER, AGENT, '/repo', 'session-1'),
      { wrapper }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))

    act(() => {
      MockEventSource.instances[0].emit('connected', { clientId: 'client-1' })
    })

    await waitFor(() => {
      expect(useSessionStatus.getState().getStatus('session-1')).toEqual({ type: 'idle' })
    })

    unmount()
  })

  it('preserves optimistic active status when a poll snapshot omits the session', () => {
    useSessionStatus.getState().setOptimisticActive('session-1', 10_000)

    useSessionStatus.getState().replaceStatuses({})

    expect(useSessionStatus.getState().getStatus('session-1')).toEqual({ type: 'busy' })

    useSessionStatus.getState().replaceStatuses({
      'session-1': { type: 'idle' },
    })

    expect(useSessionStatus.getState().getStatus('session-1')).toEqual({ type: 'idle' })
  })

  it('ignores stale status snapshots after the directory changes', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    let resolveRepoA: (value: { statuses: Record<string, { type: 'busy' }> }) => void = () => {}
    let resolveRepoB: (value: { statuses: Record<string, { type: 'busy' }> }) => void = () => {}
    mocks.listStatuses
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRepoA = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRepoB = resolve }))

    const { rerender, unmount } = renderHook(
      ({ directory }) => useSSE(SERVER, AGENT, directory, 'session-1'),
      { wrapper, initialProps: { directory: '/repo-a' } }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))

    act(() => {
      MockEventSource.instances[0].emit('connected', { clientId: 'client-1' })
    })

    rerender({ directory: '/repo-b' })

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2))

    act(() => {
      MockEventSource.instances[1].emit('connected', { clientId: 'client-2' })
    })

    await act(async () => {
      resolveRepoB({ statuses: { 'session-b': { type: 'busy' } } })
    })

    await waitFor(() => {
      expect(useSessionStatus.getState().getStatus('session-b')).toEqual({ type: 'busy' })
    })

    await act(async () => {
      resolveRepoA({ statuses: { 'session-a': { type: 'busy' } } })
    })

    expect(useSessionStatus.getState().getStatus('session-b')).toEqual({ type: 'busy' })
    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'idle' })

    unmount()
  })

  it('sets single-session cache and invalidates session list on session.updated', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData')

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result, unmount } = renderHook(
      () => useSSE(SERVER, AGENT, '/repo', 'session-1'),
      { wrapper }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))

    act(() => {
      MockEventSource.instances[0].emit('connected', { clientId: 'client-1' })
    })

    await waitFor(() => expect(result.current.isConnected).toBe(true))

    // Clear initial connection-related calls
    invalidateQueriesSpy.mockClear()
    setQueryDataSpy.mockClear()

    const sessionData = versionedSession('session-2', 'Updated Session')

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'session.updated',
        properties: { session: sessionData },
      })
    })

    await waitFor(() => {
      expect(setQueryDataSpy).toHaveBeenCalledWith(
        sessionQueryKey(SERVER, 'session-2', '/repo'),
        sessionData,
      )
    })

    await waitFor(() => {
      expect(invalidateQueriesSpy).toHaveBeenCalledWith(
        expect.objectContaining({ predicate: expect.any(Function) }),
      )
    })

    unmount()
  })

  it('clears optimistic active status when session status reports idle', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    queryClient.setQueryData(messagesQueryKey(SERVER, 'session-1', '/repo'), [])
    useSessionStatus.getState().setOptimisticActive('session-1')

    const { result, unmount } = renderHook(
      () => useSSE(SERVER, AGENT, '/repo', 'session-1'),
      { wrapper },
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))

    act(() => {
      MockEventSource.instances[0].emit('connected', { clientId: 'client-1' })
    })

    await waitFor(() => expect(result.current.isConnected).toBe(true))
    useSessionStatus.getState().setOptimisticActive('session-1')

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'session.status',
        properties: {
          sessionId: 'session-1',
          status: { type: 'idle' },
        },
      })
    })

    expect(useSessionStatus.getState().getStatus('session-1')).toEqual({ type: 'idle' })

    unmount()
  })

  it('stores queued prompt text for restoration when the queued session errors', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    useSendErrorStore.getState().setQueuedPrompt('session-1', 'queued message')

    const { result, unmount } = renderHook(
      () => useSSE(SERVER, AGENT, '/repo', 'session-1'),
      { wrapper },
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))

    act(() => {
      MockEventSource.instances[0].emit('connected', { clientId: 'client-1' })
    })

    await waitFor(() => expect(result.current.isConnected).toBe(true))

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'message.updated',
        properties: {
          message: {
            ...assistantMessage('session-1', 'assistant-current').info,
            id: 'assistant-current',
            role: 'assistant',
          },
        },
      })
    })

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'session.error',
        properties: {
          sessionId: 'session-1',
          error: {
            kind: 'unknown',
            message: 'Queued send failed',
            providerId: null,
            statusCode: null,
            isRetryable: null,
          },
        },
      })
    })

    expect(useSendErrorStore.getState().getError('session-1')).toEqual({
      sessionID: 'session-1',
      title: 'Error',
      message: 'Queued send failed',
      failedPrompt: 'queued message',
      kind: 'session',
    })

    unmount()
  })

  it('retracts a network send error when the server confirms session activity', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    useSendErrorStore.getState().setError({
      sessionID: 'session-1',
      title: 'Connection Failed',
      message: 'Could not connect to the server.',
      failedPrompt: 'in-flight prompt',
      kind: 'network',
    })

    const { result, unmount } = renderHook(
      () => useSSE(SERVER, AGENT, '/repo', 'session-1'),
      { wrapper },
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    act(() => {
      MockEventSource.instances[0].emit('connected', { clientId: 'client-1' })
    })
    await waitFor(() => expect(result.current.isConnected).toBe(true))

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'message.updated',
        properties: {
          message: assistantMessage('session-1', 'assistant-1').info,
        },
      })
    })

    expect(useSendErrorStore.getState().getError('session-1')).toBeNull()

    unmount()
  })

  it('retracts a network send error when the session goes idle', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    useSendErrorStore.getState().setError({
      sessionID: 'session-1',
      title: 'Request Timeout',
      message: 'The request took too long.',
      kind: 'network',
    })

    const { result, unmount } = renderHook(
      () => useSSE(SERVER, AGENT, '/repo', 'session-1'),
      { wrapper },
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    act(() => {
      MockEventSource.instances[0].emit('connected', { clientId: 'client-1' })
    })
    await waitFor(() => expect(result.current.isConnected).toBe(true))

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'session.idle',
        properties: { sessionId: 'session-1' },
      })
    })

    expect(useSendErrorStore.getState().getError('session-1')).toBeNull()

    unmount()
  })

  it('preserves a server-reported session error when the session later goes idle', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    useSendErrorStore.getState().setQueuedPrompt('session-1', 'queued message')

    const { result, unmount } = renderHook(
      () => useSSE(SERVER, AGENT, '/repo', 'session-1'),
      { wrapper },
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    act(() => {
      MockEventSource.instances[0].emit('connected', { clientId: 'client-1' })
    })
    await waitFor(() => expect(result.current.isConnected).toBe(true))

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'session.error',
        properties: {
          sessionId: 'session-1',
          error: {
            kind: 'unknown',
            message: 'Queued send failed',
            providerId: null,
            statusCode: null,
            isRetryable: null,
          },
        },
      })
    })

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'session.idle',
        properties: { sessionId: 'session-1' },
      })
    })

    expect(useSendErrorStore.getState().getError('session-1')).not.toBeNull()

    unmount()
  })

  it('does not create a send error banner once the queued prompt has been cleared', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    useSendErrorStore.getState().setQueuedPrompt('session-1', 'queued message')

    const { result, unmount } = renderHook(
      () => useSSE(SERVER, AGENT, '/repo', 'session-1'),
      { wrapper },
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))

    act(() => {
      MockEventSource.instances[0].emit('connected', { clientId: 'client-1' })
    })

    await waitFor(() => expect(result.current.isConnected).toBe(true))

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'message.updated',
        properties: {
          message: {
            ...assistantMessage('session-1', 'queued-user').info,
            id: 'queued-user',
            role: 'user',
          },
        },
      })
    })

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'session.error',
        properties: {
          sessionId: 'session-1',
          error: {
            kind: 'unknown',
            message: 'Unrelated failure',
            providerId: null,
            statusCode: null,
            isRetryable: null,
          },
        },
      })
    })

    expect(useSendErrorStore.getState().getError('session-1')).toBeNull()

    unmount()
  })

  it('routes streamed part deltas to the event directory in multi-directory subscriptions', async () => {
    const origRAF = window.requestAnimationFrame
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0)
      return 0
    }) as typeof window.requestAnimationFrame

    try {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })

      // Seed both directory caches before rendering the hook
      queryClient.setQueryData(
        messagesQueryKey(SERVER, 'session-1', '/repo-a'),
        [{
          ...assistantMessage('session-1', 'message-1'),
          parts: [createTextPart('part-1', 'A')],
        }],
      )
      queryClient.setQueryData(
        messagesQueryKey(SERVER, 'session-1', '/repo-b'),
        [{
          ...assistantMessage('session-1', 'message-1'),
          parts: [createTextPart('part-1', 'B')],
        }],
      )

      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      )

      // Use stable reference to avoid re-render loop with inline array
      const directories = ['/repo-a', '/repo-b']
      const { result, unmount } = renderHook(
        () => useSSE(SERVER, AGENT, directories, 'session-1'),
        { wrapper },
      )

      await waitFor(() => {
        expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(1)
      })

      const eventSource = MockEventSource.instances[MockEventSource.instances.length - 1]

      act(() => {
        eventSource.emit('connected', { clientId: 'client-1' })
      })

      await waitFor(() => expect(result.current.isConnected).toBe(true))

      act(() => {
        eventSource.emit('message', {
          type: 'message.part.delta',
          directory: '/repo-b',
          properties: {
            sessionId: 'session-1',
            messageId: 'message-1',
            partId: 'part-1',
            field: 'text',
            delta: ' + streamed',
          },
        })
      })

      const repoBData = queryClient.getQueryData<MessageWithParts[]>(
        messagesQueryKey(SERVER, 'session-1', '/repo-b'),
      )
      expect(repoBData![0].parts[0]).toHaveProperty('text', 'B + streamed')

      const repoAData = queryClient.getQueryData<MessageWithParts[]>(
        messagesQueryKey(SERVER, 'session-1', '/repo-a'),
      )
      expect(repoAData![0].parts[0]).toHaveProperty('text', 'A')

      unmount()
    } finally {
      window.requestAnimationFrame = origRAF
    }
  })

  it('processes part deltas when directory transitions from undefined to a real value', async () => {
    const origRAF = window.requestAnimationFrame
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0)
      return 0
    }) as typeof window.requestAnimationFrame

    try {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      )

      // Seed cache with an empty part
      queryClient.setQueryData(
        messagesQueryKey(SERVER, 'session-1', '/repo'),
        [{
          ...assistantMessage('session-1', 'message-1'),
          parts: [createTextPart('part-1', '')],
        }],
      )

      // Initial render with directory=undefined - batcher should be created eagerly
      const { rerender, unmount } = renderHook(
        ({ directory }) => useSSE(SERVER, AGENT, directory, 'session-1'),
        { wrapper, initialProps: { directory: undefined as string | undefined } },
      )

      // No SSE subscription yet because directoriesList is empty
      expect(MockEventSource.instances).toHaveLength(0)

      // Re-render with a real directory to start the SSE subscription
      rerender({ directory: '/repo' })

      await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
      const eventSource = MockEventSource.instances[0]

      act(() => {
        eventSource.emit('connected', { clientId: 'client-1' })
      })

      // Emit a part delta - the batcher was created on the initial mount,
      // so it should process the event even though directory was undefined at mount time
      act(() => {
        eventSource.emit('message', {
          type: 'message.part.delta',
          directory: '/repo',
          properties: {
            sessionId: 'session-1',
            messageId: 'message-1',
            partId: 'part-1',
            field: 'text',
            delta: 'streamed content',
          },
        })
      })

      await waitFor(() => {
        const data = queryClient.getQueryData<MessageWithParts[]>(
          messagesQueryKey(SERVER, 'session-1', '/repo'),
        )
        expect(data![0].parts[0]).toHaveProperty('text', 'streamed content')
      })

      unmount()
    } finally {
      window.requestAnimationFrame = origRAF
    }
  })
})
