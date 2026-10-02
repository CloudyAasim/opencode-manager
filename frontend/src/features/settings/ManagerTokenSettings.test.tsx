import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ManagerTokenSettings } from './ManagerTokenSettings'
import { useManagerToken } from '@/hooks/useManagerToken'
import { showErrorToast } from '@/lib/error-toast'
import { showToast } from '@/lib/toast'

vi.mock('@/hooks/useManagerToken', () => ({
  useManagerToken: vi.fn(),
}))

vi.mock('@/lib/error-toast', () => ({
  showErrorToast: vi.fn(),
}))

vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}))

const rotate = vi.fn()

function mockHook() {
  vi.mocked(useManagerToken).mockReturnValue({
    token: 'secret-token',
    isLoading: false,
    rotate: { mutate: rotate, isPending: false },
  } as unknown as ReturnType<typeof useManagerToken>)
}

const rotateButton = () => screen.getByRole('button', { name: 'Rotate token' })

/** The control is a two-step confirm: click once to arm, again to fire. */
async function confirmRotate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(rotateButton())
  await user.click(rotateButton())
}

describe('ManagerTokenSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHook()
  })

  it('says so when rotating fails - an old token you cannot tell apart from a new one is worse than none', async () => {
    rotate.mockImplementation((_vars: unknown, opts: { onError: (e: Error) => void }) => {
      opts.onError(new Error('nope'))
    })
    const user = userEvent.setup()
    render(<ManagerTokenSettings />)

    await confirmRotate(user)

    await waitFor(() => expect(showErrorToast).toHaveBeenCalled())
    expect(vi.mocked(showErrorToast).mock.calls[0]?.[1]).toBe('Could not rotate the token')
    expect(showToast.success).not.toHaveBeenCalled()
  })

  it('confirms a rotation that worked', async () => {
    rotate.mockImplementation((_vars: unknown, opts: { onSuccess: () => void }) => {
      opts.onSuccess()
    })
    const user = userEvent.setup()
    render(<ManagerTokenSettings />)

    await confirmRotate(user)

    await waitFor(() => expect(showToast.success).toHaveBeenCalledWith('Token rotated'))
    expect(showErrorToast).not.toHaveBeenCalled()
  })

  it('says so when copying the token fails instead of swallowing it', async () => {
    const user = userEvent.setup()
    // userEvent.setup() installs its own clipboard stub, so ours has to go in
    // after it or we would be testing the stub
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    render(<ManagerTokenSettings />)

    await user.click(screen.getByRole('button', { name: 'Copy token' }))

    await waitFor(() => expect(showErrorToast).toHaveBeenCalled())
    expect(vi.mocked(showErrorToast).mock.calls[0]?.[1]).toBe('Could not copy the token')
  })
})
