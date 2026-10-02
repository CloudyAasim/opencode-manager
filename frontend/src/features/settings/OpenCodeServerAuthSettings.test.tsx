import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OpenCodeServerAuthSettings } from './OpenCodeServerAuthSettings'
import { useOpenCodeServerAuth } from '@/hooks/useOpenCodeServerAuth'
import { showErrorToast } from '@/lib/error-toast'

vi.mock('@/hooks/useOpenCodeServerAuth', () => ({
  useOpenCodeServerAuth: vi.fn(),
}))

vi.mock('@/lib/error-toast', () => ({
  showErrorToast: vi.fn(),
}))

const mutate = vi.fn()
const clearMutate = vi.fn()

function mockHook() {
  vi.mocked(useOpenCodeServerAuth).mockReturnValue({
    status: { set: true, source: 'db' },
    isLoading: false,
    setPassword: { mutate, isPending: false },
    clearPassword: { mutate: clearMutate, isPending: false },
  } as unknown as ReturnType<typeof useOpenCodeServerAuth>)
}

const passwordField = () => screen.getByPlaceholderText('Enter new password')

describe('OpenCodeServerAuthSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHook()
  })

  it('keeps the typed password when the save fails', async () => {
    // run the onError the component passed, as react-query would
    mutate.mockImplementation((_password: string, opts: { onError: (e: Error) => void }) => {
      opts.onError(new Error('nope'))
    })
    const user = userEvent.setup()
    render(<OpenCodeServerAuthSettings />)

    await user.type(passwordField(), 'hunter2hunter2')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(showErrorToast).toHaveBeenCalled())
    // the whole point: the field the user just typed into is still there
    expect(passwordField()).toHaveValue('hunter2hunter2')
  })

  it('clears the field only after the server has the password', async () => {
    mutate.mockImplementation((_password: string, opts: { onSuccess: () => void }) => {
      opts.onSuccess()
    })
    const user = userEvent.setup()
    render(<OpenCodeServerAuthSettings />)

    await user.type(passwordField(), 'hunter2hunter2')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(passwordField()).toHaveValue(''))
    expect(showErrorToast).not.toHaveBeenCalled()
  })

  it('says so when clearing the stored password fails', async () => {
    clearMutate.mockImplementation((_vars: unknown, opts: { onError: (e: Error) => void }) => {
      opts.onError(new Error('nope'))
    })
    const user = userEvent.setup()
    render(<OpenCodeServerAuthSettings />)

    await user.click(screen.getByRole('button', { name: 'Clear stored password' }))

    await waitFor(() => expect(showErrorToast).toHaveBeenCalled())
    expect(vi.mocked(showErrorToast).mock.calls[0]?.[1]).toBe('Could not clear the stored password')
  })
})
