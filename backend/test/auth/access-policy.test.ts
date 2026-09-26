import { describe, it, expect, vi, beforeEach } from 'vitest'
import { canCreateAccount, isEmailAllowed, isSelfSignupAllowed } from '../../src/auth/access-policy'

const { ENV } = vi.hoisted(() => ({
  ENV: {
    AUTH: {
      ALLOW_SIGNUP: false,
      ALLOWED_EMAILS: '',
      ALLOWED_EMAIL_DOMAINS: '',
    },
  },
}))

vi.mock('@opencode-manager/shared/config/env', () => ({ ENV }))

describe('access policy', () => {
  beforeEach(() => {
    ENV.AUTH.ALLOW_SIGNUP = false
    ENV.AUTH.ALLOWED_EMAILS = ''
    ENV.AUTH.ALLOWED_EMAIL_DOMAINS = ''
  })

  it('disables self signup by default', () => {
    expect(isSelfSignupAllowed()).toBe(false)
    expect(isEmailAllowed('someone@example.com')).toBe(false)
    expect(canCreateAccount('someone@example.com')).toBe(false)
  })

  it('allows every account when signup is explicitly enabled', () => {
    ENV.AUTH.ALLOW_SIGNUP = true
    expect(isSelfSignupAllowed()).toBe(true)
    expect(canCreateAccount('anyone@example.com')).toBe(true)
  })

  it('allows allowlisted emails and domains while signup stays disabled', () => {
    ENV.AUTH.ALLOWED_EMAILS = 'Friend@Example.com'
    ENV.AUTH.ALLOWED_EMAIL_DOMAINS = '@partner.org'

    expect(canCreateAccount('friend@example.com')).toBe(true)
    expect(canCreateAccount('friend@example.com'.toUpperCase())).toBe(true)
    expect(canCreateAccount('dev@partner.org')).toBe(true)
    expect(canCreateAccount('stranger@example.com')).toBe(false)
  })

  it('rejects missing or malformed emails', () => {
    expect(canCreateAccount(undefined)).toBe(false)
    expect(canCreateAccount(null)).toBe(false)
    expect(canCreateAccount('')).toBe(false)
  })
})
