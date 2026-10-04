import { createMiddleware } from 'hono/factory'
import { timingSafeEqual } from 'node:crypto'
import type { Database } from 'bun:sqlite'
import type { Context } from 'hono'
import { findUserIdByToken, getOrCreateInternalToken } from '../services/internal-token'
import { findAgentSession } from '../services/agent-session'
import { findUserIdentity } from './ownership'
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
 * user: putting a subject on the context as `user` is what makes the ownership
 * filters already written for the web API apply here, instead of this path
 * growing its own second copy of "is this an admin".
 */
export interface InternalUser {
  id: string
  role: 'admin' | 'user'
  username: string | null
}

export interface InternalIdentity {
  user: InternalUser | null
  reason: UnattributedReason | null
}

/**
 * Which OpenCode session a plugin request is running in, and therefore whose
 * it is. One lookup, one answer: two queries could disagree if a row landed in
 * between, and then the log would describe a different request from the one
 * that got through.
 */
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

function presentedToken(header: string): string | null {
  if (header.startsWith('Bearer ')) return header.slice(7)
  if (header.startsWith('Basic ')) return extractTokenFromBasic(header)
  return null
}

const UNATTRIBUTED_401 = {
  error: 'Unauthorized',
  message: 'This request could not be attributed to a user. The manager token is shared by every tenant, '
    + 'so a request that uses it has to report the OpenCode session it is running in. '
    + 'Tools that run outside a session should use a personal token from Settings.',
}

/**
 * Two credentials reach the internal API, and they prove different things.
 *
 * A **user token** is a person. It was minted for them and it names them, so
 * nothing further is asked of it. The `ocm` CLI runs on someone's own machine
 * and carries this.
 *
 * The **plugin token** is the OpenCode server's, and it is shared by every
 * tenant by construction - one process serves all of them - so it can only
 * ever answer "this is our plugin". What says which tenant is the session the
 * plugin reports, and a plugin request that cannot be placed is **refused**
 * rather than served on the strength of a token that says nothing about who is
 * asking.
 *
 * That refusal is the point of the whole exercise. Before it, the Settings page
 * handed the shared token to any signed-in user, and one curl with it read
 * every tenant's repositories and every tenant's session ids - including the
 * session ids this identity scheme is built on.
 */
export function createInternalTokenMiddleware(db: Database) {
  return createMiddleware(async (c, next) => {
    const header = c.req.header('authorization') ?? c.req.header('Authorization')
    if (!header) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const presented = presentedToken(header)
    if (!presented) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // The shared token is checked first on purpose: every tenant can see it, so
    // a value matching it must be treated as the weaker credential rather than
    // as whoever a user token might collide with.
    if (tokenMatch(presented, getOrCreateInternalToken(db))) {
      const sessionId = c.req.header(SESSION_HEADER)
      const { user, reason } = resolveInternalIdentity(db, sessionId)
      if (!user) {
        logger.warn(
          `[ocm-identity] internal request not attributable: reason=${reason} `
          + `session=${sessionId?.trim() || '-'} method=${c.req.method} path=${new URL(c.req.url).pathname}`,
        )
        return c.json(UNATTRIBUTED_401, 401)
      }
      // Same key a signed-in session uses, so the ownership filters written for
      // the web API apply with no second implementation of them.
      ;(c as unknown as Context).set('user', user)
      return next()
    }

    const userId = findUserIdByToken(db, presented)
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // The role comes from the user record, not from a session: a CLI is not
    // running in one, and copying a role off whatever it last touched would let
    // the two disagree.
    const owner = findUserIdentity(db, userId)
    ;(c as unknown as Context).set('user', {
      id: userId,
      role: owner?.role === 'admin' ? 'admin' : 'user',
      username: owner?.username ?? null,
    } satisfies InternalUser)
    return next()
  })
}
