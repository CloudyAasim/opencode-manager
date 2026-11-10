import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDeleteSession, useMessages, useSessionsAcrossDirectories } from './useOpenCode'
import { useSendErrorStore } from '../stores/sendErrorStore'

vi.mock('../lib/toast', () => ({
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('useDeleteSession', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('falls back to workspace delete for stale workspace session deletes', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('Workspace not found: wrk_stale', { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useDeleteSession('/api/opencode', ['/w/stale']), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([
        { id: 'ses_1', directory: '/w/stale', workspaceID: 'wrk_stale' },
        { id: 'ses_2', directory: '/w/stale', workspaceID: 'wrk_stale' },
      ])
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost/api/opencode/session/ses_1?directory=%2Fw%2Fstale',
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost/api/opencode/experimental/workspace/wrk_stale?directory=%2Fw%2Fstale',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('falls back to workspace delete for OpenCode unknown session delete failures', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: 'UnknownError',
        data: { message: 'Unexpected server error. Check server logs for details.' },
      }), { status: 500, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useDeleteSession('/api/opencode', ['/w/existing']), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([{ id: 'ses_1', directory: '/w/existing', workspaceID: 'wrk_existing' }])
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost/api/opencode/experimental/workspace/wrk_existing?directory=%2Fw%2Fexisting',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})

describe('useSessionsAcrossDirectories', () => {
  const fetchMock = vi.fn()

  const sessions = [
    {
      id: 'session-1',
      agentId: 'opencode',
      title: 'Test Session',
      directory: '/repo',
      workspaceId: null,
      parentId: null,
      createdAt: 1000,
      updatedAt: 1000,
      archived: false,
      status: 'idle' as const,
    },
  ]

  const urlOf = (call: number) => new URL(String(fetchMock.mock.calls[call]![0]))

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks the layer once for every directory, instead of once per directory', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ sessions, cursors: {} }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(
      () => useSessionsAcrossDirectories('', ['/repo', '/other'], { limit: 25 }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toHaveLength(1)
    expect(result.current.data[0].id).toBe('session-1')
    expect(result.current.data[0].title).toBe('Test Session')
    expect(result.current.hasNextPage).toBe(false)

    // One request for two directories, not one for each.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = urlOf(0)
    expect(url.pathname).toBe('/api/bff/sessions')
    expect(url.searchParams.getAll('directories')).toEqual(['/repo', '/other'])
    expect(url.searchParams.get('limit')).toBe('25')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('fetches next page with the cursors it was given and flattens the answers', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessions, cursors: { '/repo': 'cursor_next' } }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          sessions: [{ ...sessions[0]!, id: 'session-2', title: 'Page 2' }],
          cursors: {},
        }), { headers: { 'Content-Type': 'application/json' } }),
      )

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useSessionsAcrossDirectories('', ['/repo']), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toHaveLength(1)
    expect(result.current.hasNextPage).toBe(true)

    await act(async () => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.data).toHaveLength(2)
    })

    expect(result.current.data[0].id).toBe('session-1')
    expect(result.current.data[1].id).toBe('session-2')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const next = urlOf(1)
    expect(next.pathname).toBe('/api/bff/sessions')
    expect(JSON.parse(next.searchParams.get('cursors')!)).toEqual({ '/repo': 'cursor_next' })
  })

  it('keeps one cursor per directory and only carries the ones it was given', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessions, cursors: { '/w/a': 'cursor_a' } }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessions: [], cursors: {} }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(
      () => useSessionsAcrossDirectories('', ['/w/a', '/w/b']),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.hasNextPage).toBe(true)

    await act(async () => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    const next = urlOf(1)
    // Only the directory that said it had more is asked again.
    expect(JSON.parse(next.searchParams.get('cursors')!)).toEqual({ '/w/a': 'cursor_a' })
    expect(next.searchParams.getAll('directories')).toEqual(['/w/a', '/w/b'])
  })

  it('sends search word when search option is provided', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ sessions, cursors: {} }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(
      () => useSessionsAcrossDirectories('', ['/repo'], { search: 'deploy' }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(urlOf(0).searchParams.get('search')).toBe('deploy')
  })
})

describe('useMessages send error reconciliation', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    useSendErrorStore.setState({ errors: {}, queuedPrompts: {} })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clears a stale network send error when fetched messages contain the prompt', async () => {
    useSendErrorStore.getState().setError({
      sessionID: 'session-1',
      title: 'Error',
      message: 'Load failed',
      failedPrompt: 'sent while backgrounded',
      kind: 'network',
    })

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([
      {
        info: { id: 'user-1', role: 'user', sessionID: 'session-1', time: { created: 1 } },
        parts: [{ id: 'part-1', type: 'text', text: 'sent while backgrounded', messageID: 'user-1', sessionID: 'session-1' }],
      },
    ]), { headers: { 'Content-Type': 'application/json' } }))

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    renderHook(() => useMessages('/api/opencode', 'session-1', '/repo'), { wrapper })

    await waitFor(() => {
      expect(useSendErrorStore.getState().getError('session-1')).toBeNull()
    })
  })

  it('keeps a network send error when fetched messages do not contain the prompt', async () => {
    useSendErrorStore.getState().setError({
      sessionID: 'session-1',
      title: 'Error',
      message: 'Load failed',
      failedPrompt: 'missing prompt',
      kind: 'network',
    })

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([
      {
        info: { id: 'user-1', role: 'user', sessionID: 'session-1', time: { created: 1 } },
        parts: [{ id: 'part-1', type: 'text', text: 'different prompt', messageID: 'user-1', sessionID: 'session-1' }],
      },
    ]), { headers: { 'Content-Type': 'application/json' } }))

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    renderHook(() => useMessages('/api/opencode', 'session-1', '/repo'), { wrapper })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    expect(useSendErrorStore.getState().getError('session-1')).toEqual(expect.objectContaining({
      failedPrompt: 'missing prompt',
    }))
  })
})
