export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 32

export const USERNAME_PATTERN = /^[a-z][a-z0-9]{2,31}$/

const RESERVED_USERNAMES = new Set([
  'repos',
  'users',
  'user',
  'config',
  'configuration',
  'data',
  'cache',
  'system',
  'root',
  'admin',
  'administrator',
  'opencode',
  'assistant',
  'schedule',
  'schedules',
  'scheduled',
  'worktrees',
  'schedule-worktrees',
  'api',
  'auth',
  'login',
  'logout',
  'settings',
  'assets',
  'static',
  'public',
  'null',
  'undefined',
  'me',
  'self',
  'anonymous',
  'guest',
  'tmp',
  'temp',
])

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.has(normalizeUsername(username))
}

export function isValidUsername(raw: string): boolean {
  const username = normalizeUsername(raw)
  if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) return false
  if (!USERNAME_PATTERN.test(username)) return false
  return !isReservedUsername(username)
}

export function sanitizeUsernameCandidate(raw: string): string {
  const cleaned = normalizeUsername(raw).replace(/[^a-z0-9]/g, '')
  const started = /^[a-z]/.test(cleaned) ? cleaned : `u${cleaned}`
  const bounded = started.slice(0, USERNAME_MAX_LENGTH)
  return bounded.length >= USERNAME_MIN_LENGTH ? bounded : `${bounded}user`.slice(0, USERNAME_MAX_LENGTH)
}

export function deriveUsernameFromEmail(email: string): string {
  const localPart = email.includes('@') ? email.slice(0, email.indexOf('@')) : email
  return sanitizeUsernameCandidate(localPart)
}

export function uniquifyUsername(base: string, taken: (candidate: string) => boolean): string {
  const candidate = sanitizeUsernameCandidate(base)
  if (isValidUsername(candidate) && !taken(candidate)) return candidate
  for (let suffix = 2; suffix < 100000; suffix += 1) {
    const suffixText = String(suffix)
    const room = USERNAME_MAX_LENGTH - suffixText.length
    const next = `${candidate.slice(0, room)}${suffixText}`
    if (isValidUsername(next) && !taken(next)) return next
  }
  throw new Error('Could not derive a unique username')
}
