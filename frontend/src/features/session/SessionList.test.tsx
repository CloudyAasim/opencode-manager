import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { SessionList } from './SessionList'

/**
 * A session, as the layer the client talks to hands it over.
 *
 * The list comes from there now, so the fixtures say what it says: the
 * working directory, the time of the last change, and the working area when
 * the agent has one.
 */
const makeSession = (
  id: string,
  title: string,
  directory: string,
  updatedAt: number,
  extra: { workspaceId?: string; parentId?: string } = {},
) => ({
  id,
  title,
  directory,
  workspaceId: extra.workspaceId ?? null,
  parentId: extra.parentId ?? null,
  agentId: 'opencode',
  createdAt: updatedAt,
  updatedAt,
  archived: false,
  status: 'idle' as const,
})

const { createSessionMock, deleteSessionMock, sessionsData, createSessionState, fetchNextPageMock, hasNextPageRef, isFetchingNextPageRef, isFetchNextPageErrorRef, useRealSessionsHookRef, lastSessionsHookArgs, sessionPinsData, togglePinMock, renameSessionMock } = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  sessionsData: [] as Array<{ id: string; title: string; directory: string; workspaceId?: string | null; parentId?: string | null; updatedAt: number }>,
  createSessionState: { directory: undefined as string | undefined },
  fetchNextPageMock: vi.fn(),
  hasNextPageRef: { current: false },
  isFetchingNextPageRef: { current: false },
  isFetchNextPageErrorRef: { current: false },
  useRealSessionsHookRef: { current: false },
  lastSessionsHookArgs: { current: undefined as { serverUrl: string; directories: string[]; options?: { search?: string; limit?: number } } | undefined },
  sessionPinsData: [] as Array<{ sessionId: string; directory: string; pinnedAt: number }>,
  togglePinMock: vi.fn(),
  renameSessionMock: vi.fn(),
}))

vi.mock('@/hooks/useOpenCode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useOpenCode')>()
  return {
    ...actual,
    useSessionsAcrossDirectories: (serverUrl: string, directories: string[], options?: { search?: string; limit?: number }) => {
      if (useRealSessionsHookRef.current) {
        return actual.useSessionsAcrossDirectories(serverUrl, directories, options)
      }
      lastSessionsHookArgs.current = { serverUrl, directories, options }
      const data = options?.search ? [] : sessionsData
      return {
        data,
        isLoading: false,
        fetchNextPage: fetchNextPageMock,
        hasNextPage: hasNextPageRef.current,
        isFetchingNextPage: isFetchingNextPageRef.current,
        isFetchNextPageError: isFetchNextPageErrorRef.current,
      }
    },
    useCreateSession: (_opcodeUrl: string, directory?: string) => {
      createSessionState.directory = directory
      return { mutate: createSessionMock }
    },
    useDeleteSession: () => ({ mutateAsync: deleteSessionMock, isPending: false }),
    // Spreading `actual` means anything the list starts using falls through to
    // the real hook, which asks for a QueryClient these tests do not all wrap.
    useUpdateSession: () => ({ mutate: renameSessionMock }),
  }
})

vi.mock('@/hooks/useSessionPins', () => ({
  useSessionPins: () => ({ data: sessionPinsData }),
  useToggleSessionPin: () => ({ mutate: togglePinMock }),
}))

describe('SessionList', () => {
  beforeEach(() => {
    sessionsData.splice(0, sessionsData.length,
      makeSession('ses_same', 'audit: mic-warmup 1/2 #2', '/w/a', Date.now(), { workspaceId: 'wrk_a' }),
      makeSession('ses_same', 'audit: mic-warmup 1/2 #2', '/w/b', Date.now(), { workspaceId: 'wrk_b' }),
      makeSession('ses_same', 'audit: mic-warmup 1/2 #2', '/w/c', Date.now(), { workspaceId: 'wrk_c' }),
    )
    createSessionMock.mockReset()
    createSessionState.directory = undefined
    deleteSessionMock.mockReset()
    deleteSessionMock.mockResolvedValue(undefined)
    fetchNextPageMock.mockReset()
    hasNextPageRef.current = false
    isFetchingNextPageRef.current = false
    isFetchNextPageErrorRef.current = false
    useRealSessionsHookRef.current = false
    lastSessionsHookArgs.current = undefined
    sessionPinsData.splice(0, sessionPinsData.length)
    togglePinMock.mockReset()
  })

  it('selects duplicate session IDs independently by workspace directory', async () => {
    const user = userEvent.setup()

    render(
      <SessionList
        directories={['/w/a', '/w/b', '/w/c']}
        onSelectSession={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Manage sessions' }))
    await user.click(screen.getByRole('button', { name: 'Select All' }))

    expect(screen.getByText('3 selected')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    const dialog = screen.getByRole('dialog', { name: 'Delete Sessions' })
    expect(dialog).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(deleteSessionMock).toHaveBeenCalledTimes(1)
      // The three directories are fetched in parallel, so the order they come
      // back in is not the order they were asked for. What matters is that
      // each one was picked on its own - the same id under three directories
      // is three sessions, not one.
      const deleted = deleteSessionMock.mock.calls[0]![0] as Array<{ directory: string }>
      expect([...deleted].sort((a, b) => a.directory.localeCompare(b.directory))).toEqual([
        { id: 'ses_same', directory: '/w/a' },
        { id: 'ses_same', directory: '/w/b' },
        { id: 'ses_same', directory: '/w/c' },
      ])
    })
  })

  it('deduplicates repeated session records from the same workspace directory', async () => {
    const user = userEvent.setup()
    sessionsData.splice(0, sessionsData.length,
      makeSession('ses_same', 'audit: mic-warmup 1/2 #2', '/w/a', Date.now()),
      makeSession('ses_same', 'audit: mic-warmup 1/2 #2', '/w/a', Date.now()),
      makeSession('ses_same', 'audit: mic-warmup 1/2 #2', '/w/a', Date.now()),
    )

    render(
      <SessionList
        directories={['/w/a', '/w/a', '/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    expect(screen.getAllByText('audit: mic-warmup 1/2 #2')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Manage sessions' }))
    await user.click(screen.getByRole('button', { name: 'Select All' }))

    expect(screen.getByText('1 selected')).toBeTruthy()
  })

  it('creates sessions in the explicit create directory', async () => {
    const user = userEvent.setup()
    sessionsData.splice(0, sessionsData.length)

    render(
      <SessionList
        directories={['/w/a', '/w/b']}
        createDirectory="/w/b"
        onSelectSession={vi.fn()}
      />,
    )

    await user.click(screen.getByText('No sessions yet'))

    expect(createSessionState.directory).toBe('/w/b')
    expect(createSessionMock).toHaveBeenCalledWith({ agent: undefined })
  })

  it('passes search query and limit option to useSessionsAcrossDirectories', async () => {
    const user = userEvent.setup()

    render(
      <SessionList
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    const searchInput = screen.getByPlaceholderText('Search sessions...')
    await user.type(searchInput, 'deploy')

    await waitFor(() => {
      expect(lastSessionsHookArgs.current?.options?.search).toBe('deploy')
      expect(lastSessionsHookArgs.current?.options?.limit).toBe(25)
    })
  })

  it('fetches next page when scrolling near the bottom and hasNextPage is true', async () => {
    hasNextPageRef.current = true

    render(
      <SessionList
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    const scrollContainer = screen.getByRole('region', { name: 'Sessions' })
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 500, configurable: true })
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 300, configurable: true })

    fireEvent.scroll(scrollContainer)

    await waitFor(() => {
      expect(fetchNextPageMock).toHaveBeenCalled()
    })
  })

  it('does not fetch next page on scroll when isFetchingNextPage is true', async () => {
    hasNextPageRef.current = true
    isFetchingNextPageRef.current = true

    render(
      <SessionList
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    const scrollContainer = screen.getByRole('region', { name: 'Sessions' })
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 500, configurable: true })
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 300, configurable: true })

    fireEvent.scroll(scrollContainer)

    await waitFor(() => {
      expect(fetchNextPageMock).not.toHaveBeenCalled()
    })
  })

  it('shows search-results empty state instead of create-session card when search returns no results', async () => {
    const user = userEvent.setup()
    // Default beforeEach data has 3 sessions; typing search triggers mock to return empty data

    render(
      <SessionList
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    await user.type(screen.getByPlaceholderText('Search sessions...'), 'nonexistent')

    await waitFor(() => {
      expect(screen.getByText('No sessions found')).toBeTruthy()
    })
    expect(screen.queryByText('No sessions yet')).toBeNull()
    expect(screen.queryByText('Click here to start a new session')).toBeNull()
  })

  it('shows create-session card when there are no sessions and no active search', () => {
    sessionsData.splice(0, sessionsData.length)

    render(
      <SessionList
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    expect(screen.getByText('No sessions yet')).toBeTruthy()
    expect(screen.getByText('Click here to start a new session')).toBeTruthy()
  })

  it('shows loading state instead of create-session card when the first page is empty but more pages are pending', () => {
    sessionsData.splice(0, sessionsData.length)
    hasNextPageRef.current = true

    render(
      <SessionList
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    expect(screen.getByText('Loading sessions...')).toBeTruthy()
    expect(screen.queryByText('No sessions yet')).toBeNull()
    expect(screen.queryByText('Click here to start a new session')).toBeNull()
  })

  it('auto-fetches next page when all visible sessions are filtered out as child sessions', async () => {
    sessionsData.splice(0, sessionsData.length,
      makeSession('child1', 'child session', '/w/a', Date.now(), { parentId: 'parent1' }),
      makeSession('child2', 'child session 2', '/w/a', Date.now(), { parentId: 'parent2' }),
    )
    hasNextPageRef.current = true
    isFetchingNextPageRef.current = false

    render(
      <SessionList
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(fetchNextPageMock).toHaveBeenCalled()
    })
  })

  it('auto-fetches next page when filtered sessions underfill the scroll viewport', async () => {
    sessionsData.splice(0, sessionsData.length,
      makeSession('root1', 'root session 1', '/w/a', 4),
      makeSession('root2', 'root session 2', '/w/a', 3),
      makeSession('root3', 'root session 3', '/w/a', 2),
      makeSession('root4', 'root session 4', '/w/a', 1),
      ...Array.from({ length: 21 }, (_, index) =>
        makeSession(`child${index}`, `child session ${index}`, '/w/a', index, { parentId: `root${index}` }),
      ),
    )
    hasNextPageRef.current = true
    const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, value: 300 })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 500 })

    try {
      render(
        <SessionList
          directories={['/w/a']}
          onSelectSession={vi.fn()}
        />,
      )

      await waitFor(() => {
        expect(fetchNextPageMock).toHaveBeenCalled()
      })
    } finally {
      if (scrollHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeightDescriptor)
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight')
      }
      if (clientHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeightDescriptor)
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
      }
    }
  })

  it('renders pinned session under a Pinned heading and excludes it from Today', () => {
    const pinnedTime = Date.now()
    sessionPinsData.push({ sessionId: 'ses_a', directory: '/w/a', pinnedAt: pinnedTime })
    sessionsData.splice(0, sessionsData.length,
      makeSession('ses_a', 'pinned session', '/w/a', pinnedTime),
    )

    render(
      <SessionList
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    expect(screen.getByText('Pinned')).toBeTruthy()
    expect(screen.getByText('pinned session')).toBeTruthy()
    // Pinned sessions are excluded from Today/Older, so Today heading should not appear
    expect(screen.queryByText('Today')).toBeNull()
  })

  it('calls togglePinMock with correct args when Pin to top is clicked', async () => {
    const user = userEvent.setup()
    sessionsData.splice(0, sessionsData.length,
      makeSession('ses_x', 'test session', '/w/a', Date.now()),
    )

    render(
      <SessionList
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    const actionsButton = screen.getByRole('button', { name: 'Session actions' })
    await user.click(actionsButton)

    const pinItem = screen.getByText('Pin to top')
    await user.click(pinItem)

    expect(togglePinMock).toHaveBeenCalledWith({ sessionId: 'ses_x', directory: '/w/a', pinned: true })
  })

  it('shows a retry action and stops automatic pagination while a next-page error is active', async () => {
    hasNextPageRef.current = true
    isFetchNextPageErrorRef.current = true

    render(
      <SessionList
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    expect(screen.getByText('Failed to load more sessions.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()

    const scrollContainer = screen.getByRole('region', { name: 'Sessions' })
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 500, configurable: true })
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 300, configurable: true })
    fireEvent.scroll(scrollContainer)

    await waitFor(() => {
      expect(fetchNextPageMock).not.toHaveBeenCalled()
    })
  })

  it('retries the next page when the retry action is clicked after an error', async () => {
    hasNextPageRef.current = true
    isFetchNextPageErrorRef.current = true
    const user = userEvent.setup()

    render(
      <SessionList
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(fetchNextPageMock).toHaveBeenCalledTimes(1)
  })

  it('shows the retry action instead of the loading state when the first page is empty and the next page failed', () => {
    sessionsData.splice(0, sessionsData.length)
    hasNextPageRef.current = true
    isFetchNextPageErrorRef.current = true

    render(
      <SessionList
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.queryByText('Loading sessions...')).toBeNull()
  })

  it('stops automatic pagination after a persistent next-page error and appends older roots on explicit retry with real React Query', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const pageOneItems = [
      ...Array.from({ length: 4 }, (_, index) =>
        makeSession(`root${index}`, `root session ${index}`, '/w/a', 100 + index),
      ),
      ...Array.from({ length: 21 }, (_, index) =>
        makeSession(`child${index}`, `child session ${index}`, '/w/a', index, { parentId: `root${index}` }),
      ),
    ]

    let cursorAttempts = 0
    let recovered = false
    let resolveRecovery: ((response: Response) => void) | undefined
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('cursor_next')) {
        cursorAttempts += 1
        if (!recovered) {
          return Promise.resolve(new Response(JSON.stringify({ error: 'persistent failure' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }))
        }
        return new Promise<Response>((resolve) => {
          resolveRecovery = resolve
        })
      }
      return Promise.resolve(new Response(JSON.stringify({
        sessions: pageOneItems,
        cursors: { '/w/a': 'cursor_next' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    })

    useRealSessionsHookRef.current = true
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: 1, retryDelay: 0 }, mutations: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    let unmount: (() => void) | undefined
    try {
      const rendered = render(
        <SessionList
          directories={['/w/a']}
          onSelectSession={vi.fn()}
        />,
        { wrapper },
      )
      unmount = rendered.unmount

      await waitFor(() => {
        expect(screen.getByText('root session 0')).toBeTruthy()
      })

      await waitFor(() => {
        expect(screen.getByText('Failed to load more sessions.')).toBeTruthy()
      })
      expect(cursorAttempts).toBe(2)

      const scrollContainer = screen.getByRole('region', { name: 'Sessions' })
      fireEvent.scroll(scrollContainer)
      fireEvent.scroll(scrollContainer)

      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(cursorAttempts).toBe(2)

      recovered = true
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      await waitFor(() => {
        expect(resolveRecovery).toBeDefined()
      })
      expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled()
      expect(screen.getByText('Loading more sessions...')).toBeTruthy()
      expect(screen.getByText('root session 0')).toBeTruthy()
      expect(screen.queryByText('child session 0')).toBeNull()

      resolveRecovery?.(new Response(JSON.stringify({
        sessions: [makeSession('older_root', 'older root session', '/w/a', 1)],
        cursors: {},
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

      await waitFor(() => {
        expect(screen.getByText('older root session')).toBeTruthy()
      })
      expect(cursorAttempts).toBe(3)
      expect(screen.getByText('root session 0')).toBeTruthy()
      expect(screen.queryByText('child session 0')).toBeNull()
      expect(screen.queryByText('Failed to load more sessions.')).toBeNull()
    } finally {
      unmount?.()
      queryClient.clear()
      vi.unstubAllGlobals()
    }
  })
})
