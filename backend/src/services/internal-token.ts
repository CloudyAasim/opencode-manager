import type { Database } from 'bun:sqlite'
import { randomBytes, timingSafeEqual } from 'node:crypto'

const KEY = 'internal_token'

/**
 * The plugin's token. One process serves every tenant, so this can only ever
 * answer "is this our plugin" - never "which tenant". What makes such a request
 * attributable is the OpenCode session it reports, not the token.
 */
export function getOrCreateInternalToken(db: Database): string {
  const row = db.prepare('SELECT value FROM app_secrets WHERE key = ?').get(KEY) as { value: string } | undefined
  if (row) return row.value
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  db.prepare('INSERT INTO app_secrets (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)').run(KEY, token, now, now)
  return token
}

export function rotateInternalToken(db: Database): string {
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  db.prepare(`
    INSERT INTO app_secrets (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(KEY, token, now, now)
  return token
}

/**
 * A user's own token for the internal API, minted on first ask.
 *
 * A user who has never opened the token panel has no row, and minting one here
 * is what lets the panel stay a plain read.
 */
export function getOrCreateUserToken(db: Database, userId: string): string {
  const row = db.prepare('SELECT token FROM internal_user_token WHERE user_id = ?').get(userId) as { token: string } | undefined
  if (row) return row.token
  return rotateUserToken(db, userId)
}

export function rotateUserToken(db: Database, userId: string): string {
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  db.prepare(`
    INSERT INTO internal_user_token (user_id, token, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET token = excluded.token
  `).run(userId, token, now)
  return token
}

function tokenMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Who a user token belongs to, or null.
 *
 * The index finds the row; the constant-time comparison confirms it. Doing it
 * in that order keeps the lookup off a full table scan without giving up the
 * timing-safe check on a credential that is presented on every request.
 */
export function findUserIdByToken(db: Database, provided: string): string | null {
  const row = db
    .prepare('SELECT user_id, token FROM internal_user_token WHERE token = ?')
    .get(provided) as { user_id: string; token: string } | undefined
  if (!row) return null
  return tokenMatch(provided, row.token) ? row.user_id : null
}
