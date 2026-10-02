import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { AccountSettings } from './AccountSettings'
import { useAuth } from '@/hooks/useAuth'
import { passkey } from '@/lib/auth-client'

vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/auth-client', () => ({
  passkey: { deletePasskey: vi.fn(), addPasskey: vi.fn() },
  changePassword: vi.fn(),
}))

const passkeys = [
  { id: 'pk1', name: 'Laptop', credentialID: 'c1', createdAt: '2026-01-01', deviceType: 'singleDevice' },
]

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(<AccountSettings />, { wrapper: Wrapper })
}

const dialog = () => screen.getByRole('dialog')

async function openDeleteDialog(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('Laptop')
  // the row button and the dialog's confirm button are both called "Delete",
  // so the first click is on the row and the second is scoped to the dialog
  await user.click(screen.getAllByRole('button', { name: /^delete$/i })[0]!)
  await user.click(await screen.findByRole('button', { name: /^delete$/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 'u1', email: 'a@b.c', name: 'A' },
    addPasskey: vi.fn(),
    logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => passkeys }))
})

/**
 * The dialog is given `isDeleting={deletePasskeyMutation.isPending}` and the
 * handler used to close it on the same line it fired the mutation, so the
 * "Deleting..." state could never be seen: nothing happened on screen until
 * the passkey list silently changed, or did not change at all. The same shape
 * was fixed in ProviderSettings in an earlier round.
 */
describe('deleting a passkey', () => {
  it('shows the pending state instead of closing the dialog under the user', async () => {
    let release!: (v: unknown) => void
    vi.mocked(passkey.deletePasskey).mockReturnValue(new Promise((r) => { release = r }))
    const user = userEvent.setup()
    renderPanel()

    await openDeleteDialog(user)

    await waitFor(() => expect(passkey.deletePasskey).toHaveBeenCalledWith({ id: 'pk1' }))
    // still here, and saying what it is doing
    expect(within(dialog()).getByRole('button', { name: /deleting/i })).toBeInTheDocument()

    release({ data: {} })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('leaves the dialog open when the delete fails, so it can be retried', async () => {
    // this client reports failure in the resolved value, not by rejecting
    vi.mocked(passkey.deletePasskey).mockResolvedValue({ error: { message: 'nope' } })
    const user = userEvent.setup()
    renderPanel()

    await openDeleteDialog(user)

    await waitFor(() => expect(passkey.deletePasskey).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
  })
})
