const USERNAME_MAX_LENGTH = 32

const RESERVED = new Set([
  'repos', 'users', 'user', 'config', 'configuration', 'data', 'cache', 'system', 'root',
  'admin', 'administrator', 'opencode', 'assistant', 'schedule', 'schedules', 'scheduled',
  'worktrees', 'schedule-worktrees', 'api', 'auth', 'login', 'logout', 'settings', 'assets',
  'static', 'public', 'null', 'undefined', 'me', 'self', 'anonymous', 'guest', 'tmp', 'temp',
])

export function sanitizeUsername(raw: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  const started = /^[a-z]/.test(cleaned) ? cleaned : `u${cleaned}`
  const bounded = started.slice(0, USERNAME_MAX_LENGTH)
  return bounded.length >= 3 ? bounded : `${bounded}user`.slice(0, USERNAME_MAX_LENGTH)
}

export function usernameFromEmail(email: string): string {
  const localPart = email.includes('@') ? email.slice(0, email.indexOf('@')) : email
  return sanitizeUsername(localPart)
}

export function uniqueUsername(base: string, taken: Set<string>): string {
  const candidate = sanitizeUsername(base)
  if (!RESERVED.has(candidate) && !taken.has(candidate)) return candidate
  for (let suffix = 2; suffix < 100000; suffix += 1) {
    const text = String(suffix)
    const next = `${candidate.slice(0, USERNAME_MAX_LENGTH - text.length)}${text}`
    if (next.length >= 3 && !RESERVED.has(next) && !taken.has(next)) return next
  }
  return candidate
}

/**
 * Picks a username for a new account and records it as taken.
 *
 * A username is the key for everything per-user on disk - the workspace, the
 * settings directory, the assistant workspace, the per-user model provider
 * credentials. It was only ever assigned by the one-off backfill in migration
 * 023, so every account created since got `NULL`, and the paths keyed on it
 * either fell back to a server-global directory shared by every such user
 * (`getAssistantModeDirectory`) or refused outright (`/api/providers` answers
 * 401). The `username` auth field is declared `input: false`, so a client
 * cannot supply one either.
 */
export function assignUsername(email: string, taken: Set<string>): string {
  const username = uniqueUsername(usernameFromEmail(email), taken)
  taken.add(username)
  return username
}

interface SqliteLike {
  prepare(sql: string): { all(...params: unknown[]): unknown[] }
}

/**
 * Gives a pending account its username, mutating the object better-auth is
 * about to insert.
 *
 * Split out of the `create.before` hook rather than inlined there, so it can be
 * tested directly: better-auth's sign-up cannot run under this project's vitest
 * setup, because its Kysely adapter calls `db.transaction` on a dialect config
 * the `bun:sqlite` shim does not satisfy. The bug this guards was reproduced
 * under real Bun, and this is the part of the hook that actually assigns it.
 */
export function applyUsernameToNewUser(
  db: SqliteLike,
  user: { email?: unknown; id?: unknown; username?: unknown },
): string {
  const taken = new Set(
    (db.prepare('SELECT username FROM "user" WHERE username IS NOT NULL').all() as { username: string }[])
      .map((row) => row.username?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  )
  const email = typeof user.email === 'string' ? user.email : undefined
  const username = assignUsername(email ?? String(user.id ?? ''), taken)
  Object.assign(user, { username })
  return username
}
