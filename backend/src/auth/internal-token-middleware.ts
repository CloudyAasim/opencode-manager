import { createMiddleware } from 'hono/factory'
import { timingSafeEqual } from 'node:crypto'
import type { Database } from 'bun:sqlite'
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
 * Shadow mode. This exists to count the internal requests that arrive with no
 * tenant attached, and it changes nothing about how they are handled.
 *
 * Only the ones that could not be placed are logged. A line per request would
 * bury the number this exists to produce, and a request that *was* placed has
 * nothing to report.
 *
 * This is not a security control, and the log must not be read as one. A
 * session id is not a secret: `GET /schedules/all/runs` returns every run's
 * `session_id` to any agent holding the shared token, so a caller can read
 * another tenant's session id and then claim it in the header. Binding a
 * session to a tenant only means something once the internal routes are
 * narrowed by subject; until then, enforcing on this value would be theatre.
 */
export function describeUnattributed(db: Database, rawSessionId: string | undefined): UnattributedReason | null {
  const sessionId = rawSessionId?.trim()
  if (!sessionId) return 'no-session-header'

  const record = findAgentSession(db, sessionId)
  if (!record) return 'unknown-session'
  // A schedule on an unowned repository is recorded without a person on
  // purpose. There is nobody to attribute it to, so it counts as unattributed
  // rather than quietly inheriting a neighbour.
  if (!record.userId) return 'no-user'

  return null
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
    const reason = describeUnattributed(db, sessionId)
    if (reason) {
      logger.warn(
        `[ocm-identity] internal request not attributable: reason=${reason} session=${sessionId?.trim() || '-'} `
        + `method=${c.req.method} path=${new URL(c.req.url).pathname}`,
      )
    }

    await next()
  })
}
