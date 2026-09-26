import { ENV } from '@opencode-manager/shared/config/env'

export function isSelfSignupAllowed(): boolean {
  return ENV.AUTH.ALLOW_SIGNUP
}

export function isEmailAllowed(email: string): boolean {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return false

  const emails = (ENV.AUTH.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  if (emails.includes(normalized)) return true

  const domains = (ENV.AUTH.ALLOWED_EMAIL_DOMAINS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
  if (domains.length > 0) {
    const domain = normalized.split('@')[1]
    if (domain && domains.includes(domain)) return true
  }

  return false
}

export function canCreateAccount(email: string | undefined | null): boolean {
  if (isSelfSignupAllowed()) return true
  return typeof email === 'string' && isEmailAllowed(email)
}
