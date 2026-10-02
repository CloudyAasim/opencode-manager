import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { McpManager } from './McpManager'
import { useMcpServers } from '@/hooks/useMcpServers'

vi.mock('@/hooks/useMcpServers', () => ({ useMcpServers: vi.fn() }))

type Handed = ReturnType<typeof useMcpServers>

/**
 * The hook hands out two spellings on purpose: `connect` is `mutation.mutate`,
 * which returns void and walks away, and `connectAsync` is `mutation.mutateAsync`,
 * which returns the promise.
 *
 * The toggle was calling `await connect(...)`. That awaited nothing: the
 * `finally` that clears the in-flight flag and the `refetchStatus()` behind it
 * ran one microtask later, while the request was still on the wire. So the busy
 * overlay that is supposed to block the whole panel lasted no time at all, the
 * refetch raced the write it was meant to confirm, and a second click was never
 * blocked - it fired a second connect against a status the UI had not caught up
 * with yet.
 */
describe('toggling an MCP server', () => {
  let connect: ReturnType<typeof vi.fn>
  let connectAsync: ReturnType<typeof vi.fn>
  let release!: () => void

  beforeEach(() => {
    vi.clearAllMocks()
    connect = vi.fn()
    connectAsync = vi.fn(() => new Promise<void>((r) => { release = r }))
    vi.mocked(useMcpServers).mockReturnValue({
      status: { alpha: { status: 'disabled' } },
      isLoading: false,
      refetch: vi.fn(),
      connect,
      connectAsync,
      isConnecting: false,
      disconnect: vi.fn(),
      disconnectAsync: vi.fn(),
      isDisconnecting: false,
      removeAuthAsync: vi.fn(),
      isRemovingAuth: false,
    } as unknown as Handed)
  })

  function renderPanel() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    return render(
      <McpManager
        config={{ content: { mcp: { alpha: { type: 'local', command: ['serve'] } } } }}
        onUpdate={vi.fn()}
      />,
      { wrapper: Wrapper },
    )
  }

  it('keeps the panel blocked until the request actually settles', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole('switch'))

    expect(connectAsync).toHaveBeenCalledWith('alpha')
    // the void-returning one is the one that cannot be waited on
    expect(connect).not.toHaveBeenCalled()

    // still in flight: the overlay is up, so nothing on the panel is clickable
    expect(await screen.findByText(/updating|正在更新/i)).toBeInTheDocument()
    expect(screen.getByRole('switch')).toBeDisabled()

    release()

    await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled())
    await waitFor(() => expect(screen.queryByText(/updating|正在更新/i)).not.toBeInTheDocument())
  })
})
