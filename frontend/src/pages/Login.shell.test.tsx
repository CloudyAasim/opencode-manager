import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * "Change server" belongs to the login page, and only to the Android shell.
 *
 * Two claims are being checked, and they fail in opposite directions:
 *
 *   - It must NOT render outside the shell. This bundle is the same one the
 *     web and desktop builds serve, so a control that shipped unconditionally
 *     would appear everywhere and do nothing when clicked.
 *   - It MUST render, and call through, inside the shell. The shell used to
 *     pin its own 55%-alpha, border-less icon over the top-right corner of
 *     whatever page was showing - which on this page is where the language
 *     toggle lives. The affordance only stops covering things once the page
 *     draws it in its own layout, which is what this asserts.
 */

vi.mock('react-router-dom', () => ({
  useLoaderData: () => ({
    config: {
      enabledProviders: ['credentials'],
      registrationEnabled: false,
      isFirstUser: false,
      adminConfigured: true,
    },
  }),
}))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    signInWithEmail: vi.fn(async () => ({ error: null })),
    signInWithProvider: vi.fn(async () => ({ error: null })),
    signInWithPasskey: vi.fn(async () => ({ error: null })),
  }),
}))

import { Login } from './Login'

type Bridge = { OCMAndroidHost?: { changeServer?: () => void } }

function installBridge(value: Bridge['OCMAndroidHost']) {
  Object.defineProperty(window, 'OCMAndroidHost', { configurable: true, writable: true, value })
}

function removeBridge() {
  delete (window as unknown as Bridge).OCMAndroidHost
}

const BUTTON = /change server|更换服务器/i

describe('the login page and the shell bridge', () => {
  beforeEach(() => {
    removeBridge()
  })

  afterEach(() => {
    removeBridge()
    cleanup()
  })

  it('does not offer a change-server control when no shell is around it', () => {
    render(<Login />)

    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull()
  })

  it('offers one, and calls through to the shell, when a shell is there', async () => {
    const changeServer = vi.fn()
    installBridge({ changeServer })
    const user = userEvent.setup()

    render(<Login />)
    const button = screen.getByRole('button', { name: BUTTON })
    await user.click(button)

    expect(changeServer).toHaveBeenCalledTimes(1)
  })

  it('stays hidden when the bridge is present but cannot do the one thing it exists for', () => {
    // A shell from another version with a different shape. A button that
    // renders and then does nothing when pressed is worse than no button: the
    // person has no way to tell that apart from the app being broken.
    installBridge({})
    render(<Login />)

    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull()
  })

  it('draws the control as a real button rather than a floating icon', () => {
    installBridge({ changeServer: vi.fn() })
    render(<Login />)

    const classes = screen.getByRole('button', { name: BUTTON }).className.split(/\s+/)
    // `border` is the visible edge and `bg-card` the opaque surface. The old
    // affordance was a 55%-alpha icon with no background at all, which is what
    // made it unreadable against the page.
    expect(classes).toContain('border')
    expect(classes).toContain('bg-card')
    // An unconditional alpha utility is the thing being ruled out. A
    // `disabled:opacity-50` is not that - it only applies while the button is
    // unusable - so the check is for a bare `opacity-*`, not for the substring.
    expect(classes.some((c) => /^opacity-/.test(c))).toBe(false)
  })
})
