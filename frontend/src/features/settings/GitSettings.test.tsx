import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { GitSettings } from './GitSettings'
import { useSettings } from '@/hooks/useSettings'
import { showToast } from '@/lib/toast'
import { listRepos } from '@/api/repos'

vi.mock('@/hooks/useSettings', () => ({ useSettings: vi.fn() }))
vi.mock('@/hooks/useOpenCodeServerActions', () => ({
  useOpenCodeServerActions: () => ({
    restartServerMutation: {},
    confirmOpen: false,
    setConfirmOpen: vi.fn(),
    activeSessionCount: 0,
    requestRestart: vi.fn(),
    confirmRestart: vi.fn(),
  }),
}))
vi.mock('@/api/repos', () => ({
  listRepos: vi.fn(),
  updateRepoGitCredential: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}))

const laptop = { id: 'c1', name: 'Laptop', host: 'github.com', type: 'pat', token: 't' }
const desktop = { id: 'c2', name: 'Desktop', host: 'gitlab.com', type: 'ssh', sshPrivateKey: 'k' }

/**
 * The panel wrote the new credential list straight into component state and let
 * the request catch up - no react-query mutation, so none of the rules in
 * optimistic-writes.test.ts could see it. When the save failed, the only thing
 * that came back was a toast: the row stayed deleted and the default pointer
 * stayed moved, so the panel went on showing a state the server had never
 * accepted, and nothing would put it right.
 */
describe('a credential save that the server refuses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(listRepos).mockResolvedValue([])
    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        gitCredentials: [laptop, desktop],
        defaultGitCredentialId: 'c1',
        gitIdentity: { name: '', email: '' },
      },
      isLoading: false,
      isUpdating: false,
      updateSettingsAsync: vi.fn().mockRejectedValue(new Error('permission denied')),
    } as unknown as ReturnType<typeof useSettings>)
  })

  function renderPanel() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    return render(<GitSettings />, { wrapper: Wrapper })
  }

  it('puts the deleted credential back and says why', async () => {
    renderPanel()
    await screen.findByText('Laptop')

    const row = screen.getByText('Laptop').closest('tr')!
    await userEvent.setup().click(within(row).getByTitle(/delete|删除/i))

    // the server refused, so both rows have to still be there
    await waitFor(() => expect(screen.getByText('Laptop')).toBeInTheDocument())
    expect(screen.getByText('Desktop')).toBeInTheDocument()
    expect(showToast.error).toHaveBeenCalled()
  })
})
