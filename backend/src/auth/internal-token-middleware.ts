import { createMiddleware } from 'hono/factory'
import { timingSafeEqual } from 'node:crypto'
import type { Database } from 'bun:sqlite'
import type { Context } from 'hono'
import { getOrCreateInternalToken } from '../services/internal-token'
import { findAgentSession } from '../services/agent-session'
import { logger } from '../utils/logger'

function extractTokenFromBasic(header: string): string | null {
  if (!header.startsWith('Basic ')) return null
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
  const colonIndex = decoded.indexOf(':')
  if (colonIndex === -1) return null
  return decoded.slice(colonIndex + 1)
}

function tokenMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export const SESSION_HEADER = 'x-ocm-session'

export type UnattributedReason = 'no-session-header' | 'unknown-session' | 'no-user'

/**
 * The shape the rest of the app already understands.
 *
 * Deliberately the same three fields `principalFrom()` reads off a signed-in
 * user: putting a session's owner on the context as `user` is what makes the
 * ownership filters that are already written - and that have never run on this
 * path, because an internal request never had a user - start running.
 */
export interface InternalUser {
  id: string
  role: 'admin' | 'user'
  username: string | null
}

/**
 * Shadow mode, and the thing that makes narrowing possible at all.
 *
 * The internal token says "this is our plugin" and nothing about who is
 * calling. The session the plugin reports says who. This is where the two meet:
 * a request that can be placed gets its owner on the context under the same
 * `user` key a signed-in session uses, so the ownership filters already written
 * for the web API start running here - they have never run on this path,
 * because an internal request never carried a user.
 *
 * A request that cannot be placed is logged and then served exactly as it
 * always has. Only the unplaceable ones are logged: a line per request would
 * bury the number this exists to produce, and a placed one has nothing to
 * report.
 *
 * The log is not a security control and must not be read as one. A session id
 * is not a secret - `GET /schedules/all/runs` hands every run's `session_id`
 * to any agent holding the shared token - so until the routes are narrowed, a
 * caller can claim a session that is not theirs. Narrowing the routes is what
 * makes this worth anything; turning a null into a 401 is the stage after.
 */

/**
 * Who an internal request belongs to, and - when nobody could be worked out -
 * why not.
 *
 * Both come from one lookup on purpose: two queries could disagree if a row
 * landed in between, and then the log would describe a different request from
 * the one that got through.
 *
 * A null user is not an error. This stage still lets the request through
 * exactly as it always has, and the routes that consult it treat a null as
 * "no narrowing available" rather than "deny".
 */
export interface InternalIdentity {
  user: InternalUser | null
  reason: UnattributedReason | null
}

export function resolveInternalIdentity(db: Database, rawSessionId: string | undefined): InternalIdentity {
  const sessionId = rawSessionId?.trim()
  if (!sessionId) return { user: null, reason: 'no-session-header' }

  const record = findAgentSession(db, sessionId)
  if (!record) return { user: null, reason: 'unknown-session' }
  // A schedule on an unowned repository is recorded without a person on
  // purpose. There is nobody to attribute it to, so it counts as unattributed
  // rather than quietly inheriting a neighbour.
  if (!record.userId) return { user: null, reason: 'no-user' }

  return {
    user: {
      id: record.userId,
      role: record.role === 'admin' ? 'admin' : 'user',
      username: record.username,
    },
    reason: null,
  }
}

export function internalUserOf(c: unknown): InternalUser | null {
  const user = (c as { get?: (key: string) => InternalUser | undefined }).get?.('user')
  return user?.id ? user : null
}

export function createInternalTokenMiddleware(db: Database) {
  return createMiddleware(async (c, next) => {
    const header = c.req.header('authorization') ?? c.req.header('Authorization')
    if (!header) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const expected = getOrCreateInternalToken(db)

    if (header.startsWith('Bearer ')) {
      if (!tokenMatch(header.slice(7), expected)) {
        return c.json({ error: 'Unauthorized' }, 401)
      }
    } else if (header.startsWith('Basic ')) {
      const password = extractTokenFromBasic(header)
      if (!password || !tokenMatch(password, expected)) {
        return c.json({ error: 'Unauthorized' }, 401)
      }
    } else {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Past the token. A rejected request has no session worth counting, so the
    // check sits here rather than at the top.
    const sessionId = c.req.header(SESSION_HEADER)
    const { user, reason } = resolveInternalIdentity(db, sessionId)

    if (user) {
      ;(c as unknown as Context).set('user', user)
    } else {
      logger.warn(
        `[ocm-identity] internal request not attributable: reason=${reason} session=${sessionId?.trim() || '-'} `
        + `method=${c.req.method} path=${new URL(c.req.url).pathname}`,
      )
    }

    await next()
  })
}
