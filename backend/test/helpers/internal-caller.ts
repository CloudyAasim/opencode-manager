import type { Database } from 'bun:sqlite'
import { getOrCreateUserToken } from '../../src/services/internal-token'

let seq = 0

function nextId(prefix: string): string {
  seq += 1
  return `${prefix}${seq}`
}

/**
 * A caller whose identity the server already knows without asking a session.
 *
 * A user token is minted for one person, so the tests that care about a route's
 * behaviour rather than about tenancy can present one and stop arranging
 * sessions around it. The row matters: the middleware reads the role off the
 * user record rather than off whatever the token last touched, so a token
 * without a user would prove nothing.
 */
export function createInternalCaller(
  db: Database,
  options: { role?: 'admin' | 'user'; id?: string; username?: string } = {},
): { userId: string; username: string; token: string; headers: Record<string, string> } {
  const role = options.role ?? 'user'
  const userId = options.id ?? nextId('u-caller-')
  const username = options.username ?? userId
  const now = Date.now()
  db.prepare(
    `INSERT INTO "user" ("id", "name", "email", "username", "role", "emailVerified", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(userId, userId, `${userId}@example.test`, username, role, now, now)

  const token = getOrCreateUserToken(db, userId)
  return { userId, username, token, headers: { authorization: `Bearer ${token}` } }
}
