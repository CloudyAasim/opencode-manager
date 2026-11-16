import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { RepoMcpDialog } from './RepoMcpDialog'
import { mcpApi } from '@/api/mcp'

vi.mock('@/api/mcp', () => ({
  mcpApi: {
    listServers: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    authenticate: vi.fn(),
    removeAuth: vi.fn(),
    startAuth: vi.fn(),
    completeAuth: vi.fn(),
  },
}))

const alpha = {
  name: 'alpha',
  state: 'connected' as const,
  detail: null,
  kind: 'local' as const,
  command: ['serve'],
  url: null,
  oauth: null,
}

/**
 * `fetchStatus` had a `try`/`finally` and no `catch`. When the status request
 * failed, `isLoadingStatus` went back to false, `hasFetchedStatus` stayed
 * false, and the list was empty - so the list fell through to
 * `servers.map` over nothing. The panel rendered a blank box: no spinner, no
 * empty state, no error, nothing to click. The rejection itself escaped into
 * three call sites (the open effect, two mutation onSuccess) as an unhandled
 * promise rejection.
 */
describe('loading MCP servers for a location', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function renderDialog() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    return render(<RepoMcpDialog open directory="/repo" onOpenChange={vi.fn()} />, { wrapper: Wrapper })
  }

  it('says so when the request fails, and offers a way back', async () => {
    vi.mocked(mcpApi.listServers).mockRejectedValue(new Error('gateway timeout'))
    const unhandled = vi.fn()
    window.addEventListener('unhandledrejection', unhandled)

    renderDialog()

    expect(await screen.findByText(/failed to load mcp servers|加载 MCP 服务器失败/i)).toBeInTheDocument()
    expect(screen.getByText('gateway timeout')).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: /retry|重试/i })
    expect(unhandled).not.toHaveBeenCalled()

    vi.mocked(mcpApi.listServers).mockResolvedValue([alpha])
    await userEvent.setup().click(retry)

    await waitFor(() =>
      expect(screen.queryByText(/failed to load mcp servers|加载 MCP 服务器失败/i)).not.toBeInTheDocument(),
    )
    // the list title-cases the server id for display
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
  })
})
