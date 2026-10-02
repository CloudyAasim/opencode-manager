import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SESSION_PINS_QUERY_KEY, useSessionPins, useToggleSessionPin } from './useSessionPins'
import { listSessionPins, toggleSessionPin } from '@/api/sessionPins'
import { showErrorToast } from '@/lib/error-toast'
import type { SessionPin } from '@opencode-manager/shared/schemas'

vi.mock('@/api/sessionPins', () => ({
  listSessionPins: vi.fn(),
  toggleSessionPin: vi.fn(),
}))

vi.mock('@/lib/error-toast', () => ({
  showErrorToast: vi.fn(),
}))

vi.mock('@/lib/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const pin = (sessionId: string, pinnedAt = 1): SessionPin => ({
  sessionId,
  directory: '/w/a',
  pinnedAt,
})

function makeClient(pins: SessionPin[] | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  if (pins) client.setQueryData(SESSION_PINS_QUERY_KEY, pins)
  return client
}

const wrapperFor = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return Wrapper
}

describe('useToggleSessionPin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(toggleSessionPin).mockResolvedValue([])
    vi.mocked(listSessionPins).mockResolvedValue([])
  })

  it('pins the session locally before the server answers', async () => {
    const before = [pin('other')]
    const client = makeClient(before)
    let release!: (value: SessionPin[]) => void
    vi.mocked(toggleSessionPin).mockReturnValue(new Promise((r) => { release = r }))

    const { result } = renderHook(() => useToggleSessionPin(), { wrapper: wrapperFor(client) })
    result.current.mutate({ sessionId: 's1', directory: '/w/a', pinned: true })

    await waitFor(() => {
      expect(client.getQueryData<SessionPin[]>(SESSION_PINS_QUERY_KEY)).toHaveLength(2)
    })
    // the request is still in flight
    expect(toggleSessionPin).toHaveBeenCalled()
    release([...before, pin('s1', 2)])
  })

  it('puts the row back where it was when pinning fails, and says so', async () => {
    const before = [pin('other')]
    const client = makeClient(before)
    vi.mocked(toggleSessionPin).mockRejectedValue(new Error('nope'))

    const { result } = renderHook(() => useToggleSessionPin(), { wrapper: wrapperFor(client) })
    await result.current.mutateAsync({ sessionId: 's1', directory: '/w/a', pinned: true }).catch(() => {})

    expect(client.getQueryData<SessionPin[]>(SESSION_PINS_QUERY_KEY)).toEqual(before)
    expect(showErrorToast).toHaveBeenCalledWith(expect.any(Error), 'session.card.pinFailed')
  })

  it('unpins locally and rolls the same way', async () => {
    const before = [pin('other'), pin('s1', 2)]
    const client = makeClient(before)
    let release!: (value: SessionPin[]) => void
    vi.mocked(toggleSessionPin).mockReturnValue(new Promise((r) => { release = r }))

    const { result } = renderHook(() => useToggleSessionPin(), { wrapper: wrapperFor(client) })
    result.current.mutate({ sessionId: 's1', directory: '/w/a', pinned: false })

    await waitFor(() => {
      expect(client.getQueryData<SessionPin[]>(SESSION_PINS_QUERY_KEY)).toHaveLength(1)
    })
    release([pin('other')])
  })

  it('stops an in-flight refetch from putting the row back', async () => {
    const client = makeClient([pin('other')])
    const cancel = vi.spyOn(client, 'cancelQueries')
    let release!: (value: SessionPin[]) => void
    vi.mocked(toggleSessionPin).mockReturnValue(new Promise((r) => { release = r }))

    const { result } = renderHook(() => useToggleSessionPin(), { wrapper: wrapperFor(client) })
    result.current.mutate({ sessionId: 's1', directory: '/w/a', pinned: true })

    await waitFor(() => expect(cancel).toHaveBeenCalledWith({ queryKey: SESSION_PINS_QUERY_KEY }))
    release([pin('other'), pin('s1', 2)])
  })

  it('does not guess when the pin list was never loaded', async () => {
    const client = makeClient(undefined)
    vi.mocked(toggleSessionPin).mockResolvedValue([pin('s1', 2)])

    const { result } = renderHook(() => useToggleSessionPin(), { wrapper: wrapperFor(client) })
    await result.current.mutateAsync({ sessionId: 's1', directory: '/w/a', pinned: true })

    // only the server's own answer was ever written
    expect(client.getQueryData<SessionPin[]>(SESSION_PINS_QUERY_KEY)).toEqual([pin('s1', 2)])
  })
})

describe('useSessionPins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads from the one key the toggle writes', async () => {
    vi.mocked(listSessionPins).mockResolvedValue([pin('s1')])
    const client = makeClient(undefined)
    const { result } = renderHook(() => useSessionPins(), { wrapper: wrapperFor(client) })
    await waitFor(() => expect(result.current.data).toEqual([pin('s1')]))
    expect(client.getQueryData(SESSION_PINS_QUERY_KEY)).toEqual([pin('s1')])
  })
})
