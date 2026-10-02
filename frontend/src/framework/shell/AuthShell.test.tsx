import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  AuthShell,
  AuthCard,
  AuthError,
  AuthField,
  AuthSubmit,
} from './AuthShell'

describe('AuthShell', () => {
  it('shows the app name, the children and the footer', () => {
    render(
      <AuthShell subtitle={<p>the subtitle</p>} footer={<p>the footer</p>}>
        <AuthCard>
          <p>the form</p>
        </AuthCard>
      </AuthShell>,
    )

    expect(screen.getByText('OpenCode Manager')).toBeTruthy()
    expect(screen.getByText('the subtitle')).toBeTruthy()
    expect(screen.getByText('the form')).toBeTruthy()
    expect(screen.getByText('the footer')).toBeTruthy()
  })

  it('omits the subtitle and footer when they are not given', () => {
    render(
      <AuthShell>
        <p>only the form</p>
      </AuthShell>,
    )

    expect(screen.getByText('only the form')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /English/ })).not.toBeNull()
  })

  it('offers the language toggle', () => {
    render(<AuthShell>content</AuthShell>)
    const english = screen.getByRole('button', { name: 'English' })
    expect(english.getAttribute('aria-pressed')).toBeTruthy()
  })
})

describe('AuthError', () => {
  it('renders nothing without a message', () => {
    const { container } = render(<AuthError message={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the message when there is one', () => {
    render(<AuthError message="password rejected" />)
    expect(screen.getByText('password rejected')).toBeTruthy()
  })
})

describe('AuthField', () => {
  it('binds the label to the control and shows the error', () => {
    render(
      <AuthField id="email" label="Email" error="not an email">
        <input id="email" />
      </AuthField>,
    )

    const input = screen.getByLabelText('Email')
    expect(input.getAttribute('id')).toBe('email')
    expect(screen.getByText('not an email')).toBeTruthy()
  })

  it('omits the error paragraph when the field is valid', () => {
    const { container } = render(
      <AuthField id="email" label="Email">
        <input id="email" />
      </AuthField>,
    )
    expect(container.querySelector('.text-destructive')).toBeNull()
  })
})

describe('AuthSubmit', () => {
  it('shows the idle label and the idle icon when not busy', () => {
    render(<AuthSubmit busy={false} busyLabel="Signing in" idleLabel="Sign in" idleIcon={<span>icon</span>} />)
    expect(screen.getByText('Sign in')).toBeTruthy()
    expect(screen.getByText('icon')).toBeTruthy()
  })

  it('swaps to the busy label and disables itself', () => {
    render(<AuthSubmit busy busyLabel="Signing in" idleLabel="Sign in" idleIcon={<span>icon</span>} />)
    expect(screen.getByText('Signing in')).toBeTruthy()
    expect(screen.queryByText('Sign in')).toBeNull()
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true)
  })

  it('stays disabled when the caller says so even while idle', () => {
    render(
      <AuthSubmit busy={false} busyLabel="b" idleLabel="i" idleIcon={<span />} disabled />,
    )
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true)
  })
})

describe('auth pages no longer own their own frame', () => {
  it('no auth page declares a viewport height', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const dir = path.resolve(__dirname, '../../pages')
    for (const name of ['Login.tsx', 'Register.tsx', 'Setup.tsx']) {
      const source = fs.readFileSync(path.join(dir, name), 'utf8')
      expect(source, `${name} should not claim h-dvh`).not.toMatch(/h-dvh/)
      expect(source, `${name} should use the shared surface`).toMatch(/AuthShell/)
    }
  })
})
