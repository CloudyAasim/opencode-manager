import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import type { Context } from 'hono'
import { createInternalTokenMiddleware, SESSION_HEADER } from '../../src/auth/internal-token-middleware'
import { findUserIdByToken, getOrCreateInternalToken, getOrCreateUserToken } from '../../src/services/internal-token'
import { recordAgentSession } from '../../src/services/agent-session'
import { logger } from '../../src/utils/logger'
import migration001 from '../../src/db/migrations/001-base-schema'
import migration013 from '../../src/db/migrations/013-app-secrets'
import migration023 from '../../src/db/migrations/023-user-username'
import migration026 from '../../src/db/migrations/026-ocm-agent-session'
import migration027 from '../../src/db/migrations/027-internal-user-token'

/**
 * Two credentials reach the internal API and they are not interchangeable.
 *
 * A **user token** is a person: it was minted for them, so the middleware stops
 * there. A **shared token** is the OpenCode plugin's, and one process serves
 * every tenant, so on its own it says nothing about who is asking - which is
 * why a shared-token request has to name the session it is running in and is
 * refused when it cannot.
 */
/**
 * A bare `Hono` has no variable map, so `get` and `set` only accept `never`.
 * The application reaches `user` on the context through the same cast the
 * routes use; this is the way in and out of a test app.
 */
interface TestUser {
  id: string
  role: 'admin' | 'user'
  username: string | null
}

function typedContext(c: Context): { get: (key: string) => TestUser | undefined; set: (key: string, value: unknown) => void } {
  return c as unknown as { get: (key: string) => TestUser | undefined; set: (key: string, value: unknown) => void }
}

describe('internal-token-middleware', () => {
  function createTestDb(): Database {
    const db = new Database(':memory:')
    migration001.up(db)
    migration013.up(db)
    // 023, not 1: `username` is added to `user` by a later migration, and a
    // fixture that skips it is a table the product does not have.
    migration023.up(db)
    // 026 and 027 stand alone: no foreign keys, nothing either depends on.
    migration026.up(db)
    migration027.up(db)
    return db
  }

  function createTestApp(db: Database) {
    const app = new Hono()
    app.use('/*', createInternalTokenMiddleware(db))
    app.get('/test', (c) => c.json({ ok: true, user: typedContext(c).get('user') ?? null }))
    return app
  }

  function addUser(db: Database, id: string, role: 'admin' | 'user' = 'user'): string {
    const now = Date.now()
    db.prepare(
      `INSERT INTO "user" ("id", "name", "email", "username", "role", "emailVerified", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(id, id, `${id}@example.test`, id, role, now, now)
    return getOrCreateUserToken(db, id)
  }

  it('returns 401 when authorization header is missing', async () => {
    const db = createTestDb()
    const app = createTestApp(db)
    const res = await app.request('/test')
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('returns 401 when authorization header is not bearer or basic scheme', async () => {
    const db = createTestDb()
    const app = createTestApp(db)
    const res = await app.request('/test', {
      headers: { authorization: 'Digest abc123' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 when token is wrong', async () => {
    const db = createTestDb()
    const validToken = addUser(db, 'u-alice')
    const app = createTestApp(db)
    const res = await app.request('/test', {
      headers: { authorization: `Bearer ${validToken}wrong` },
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 when token has different length', async () => {
    const db = createTestDb()
    const app = createTestApp(db)
    const res = await app.request('/test', {
      headers: { authorization: 'Bearer short' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 200 when a user bearer token matches, and names that user', async () => {
    const db = createTestDb()
    const token = addUser(db, 'u-alice')
    const app = createTestApp(db)
    const res = await app.request('/test', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; user: { id: string; role: string; username: string } }
    expect(body.ok).toBe(true)
    // The same key a signed-in session uses, which is what makes the ownership
    // filters already written for the web API apply to an internal request.
    expect(body.user).toEqual({ id: 'u-alice', role: 'user', username: 'u-alice' })
  })

  it('returns 200 when basic auth password is a user token', async () => {
    const db = createTestDb()
    const token = addUser(db, 'u-alice')
    const app = createTestApp(db)
    const res = await app.request('/test', {
      headers: { authorization: 'Basic ' + Buffer.from(`opencode:${token}`).toString('base64') },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
  })

  it('returns 401 when basic auth password is wrong', async () => {
    const db = createTestDb()
    const app = createTestApp(db)
    const res = await app.request('/test', {
      headers: { authorization: 'Basic ' + Buffer.from('opencode:wrong-password').toString('base64') },
    })
    expect(res.status).toBe(401)
  })

  it('reads the role off the user record rather than off the token', async () => {
    // A token outlives the account it was minted for, and an account can be
    // demoted without the token changing. Copying a role off whatever the
    // token last touched is how the two would drift apart.
    const db = createTestDb()
    const token = addUser(db, 'u-root', 'admin')
    const app = createTestApp(db)

    await app.request('/test', { headers: { authorization: `Bearer ${token}` } })
    db.prepare('UPDATE "user" SET role = ? WHERE id = ?').run('user', 'u-root')

    const res = await app.request('/test', { headers: { authorization: `Bearer ${token}` } })
    const body = await res.json() as { user: { role: string } }
    expect(body.user.role).toBe('user')
  })

  it('falls back to the least privilege for a token whose user is gone', async () => {
    const db = createTestDb()
    const token = addUser(db, 'u-gone')
    db.prepare('DELETE FROM "user" WHERE id = ?').run('u-gone')
    const app = createTestApp(db)

    const res = await app.request('/test', { headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(200)
    const body = await res.json() as { user: { id: string; role: string } }
    expect(body.user).toEqual({ id: 'u-gone', role: 'user', username: null })
  })
})

/**
 * Fail-closed.
 *
 * The shared token is in the environment of a process every tenant shares, so
 * it can only answer "is this our plugin". Before this stage a request carrying
 * it and nothing else was served on that basis, and the Settings page was
 * handing the same value to any signed-in user - so one curl read every
 * tenant's repositories and every tenant's session ids.
 */
describe('internal-token-middleware fail-closed on the shared token', () => {
  let warn: ReturnType<typeof vi.spyOn>

  function createTestDb(): Database {
    const db = new Database(':memory:')
    migration001.up(db)
    migration013.up(db)
    migration023.up(db)
    migration026.up(db)
    migration027.up(db)
    return db
  }

  function createTestApp(db: Database) {
    const app = new Hono()
    app.use('/*', createInternalTokenMiddleware(db))
    app.get('/test', (c) => c.json({ ok: true, user: typedContext(c).get('user') ?? null }))
    return app
  }

  /** Inserts the person *and* mints their token: a row with no token is not a
   *  caller, and a test that assumes otherwise passes for the wrong reason. */
  function addUser(db: Database, id: string): string {
    const now = Date.now()
    db.prepare(
      `INSERT INTO "user" ("id", "name", "email", "username", "role", "emailVerified", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, 'user', 0, ?, ?)`,
    ).run(id, id, `${id}@example.test`, id, now, now)
    return getOrCreateUserToken(db, id)
  }

  function asPlugin(db: Database, sessionId?: string) {
    const headers: Record<string, string> = { authorization: `Bearer ${getOrCreateInternalToken(db)}` }
    if (sessionId !== undefined) headers[SESSION_HEADER] = sessionId
    return headers
  }

  const reasons = () => warn.mock.calls.map((call) => String(call[0]))

  beforeEach(() => {
    warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
  })

  it('refuses a shared token that names no session, and says how to fix it', async () => {
    const db = createTestDb()
    const res = await createTestApp(db).request('/test', { headers: asPlugin(db) })

    expect(res.status).toBe(401)
    const body = await res.json() as { error: string; message: string }
    expect(body.error).toBe('Unauthorized')
    // A person reading this in a CLI needs to know which of the two things they
    // hold to go and fix: a session id or a personal token.
    expect(body.message).toContain('Settings')
    expect(body.message).toContain('session')
    expect(reasons()[0]).toContain('reason=no-session-header')
  })

  it('lets a shared token through once the session places it', async () => {
    const db = createTestDb()
    recordAgentSession(db, {
      sessionId: 'ses_placed',
      userId: 'u-alice',
      username: 'alice',
      role: 'user',
      directory: '/workspace/users/alice/workspace',
      source: 'proxy',
    })

    const res = await createTestApp(db).request('/test', { headers: asPlugin(db, 'ses_placed') })

    expect(res.status).toBe(200)
    const body = await res.json() as { user: { id: string; role: string; username: string } }
    expect(body.user).toEqual({ id: 'u-alice', role: 'user', username: 'alice' })
    // Without this the refusal count would be unreadable: every placed request
    // would add a line and the number being measured would vanish into noise.
    expect(reasons()).toEqual([])
  })

  it('refuses a session nobody has heard of', async () => {
    const db = createTestDb()
    const res = await createTestApp(db).request('/test', { headers: asPlugin(db, 'ses_never_seen') })

    expect(res.status).toBe(401)
    expect(reasons()[0]).toContain('reason=unknown-session')
    expect(reasons()[0]).toContain('session=ses_never_seen')
  })

  it('refuses a session with nobody attached to it', async () => {
    // Not hypothetical: a schedule on an unowned repository is recorded without
    // a person. Reporting it is the point - quietly handing that session to a
    // neighbour is how a scheduled agent would end up reading someone else's
    // repositories.
    const db = createTestDb()
    recordAgentSession(db, {
      sessionId: 'ses_ownerless',
      userId: null,
      username: null,
      role: 'unknown',
      directory: '/workspace/schedule-worktrees/job-7-run-5',
      source: 'schedule',
    })

    const res = await createTestApp(db).request('/test', { headers: asPlugin(db, 'ses_ownerless') })

    expect(res.status).toBe(401)
    expect(reasons()[0]).toContain('reason=no-user')
  })

  it('treats a blank session header as no header at all', async () => {
    // HTTP trims header values on the way in, so this only ever proves the
    // classification: a blank id must land in the "no header" bucket rather
    // than being looked up and reported as an unknown session.
    const db = createTestDb()
    for (const blank of ['', '   ']) {
      warn.mockClear()
      const res = await createTestApp(db).request('/test', { headers: asPlugin(db, blank) })
      expect(res.status).toBe(401)
      expect(reasons()[0]).toContain('reason=no-session-header')
    }
  })

  it('says nothing about a request the token already rejected', async () => {
    // A request that never got in has no session worth counting, and counting
    // it would make the log describe auth failures instead of identity gaps.
    const db = createTestDb()
    const res = await createTestApp(db).request('/test', {
      headers: { authorization: 'Bearer wrong', [SESSION_HEADER]: 'ses_never_seen' },
    })

    expect(res.status).toBe(401)
    expect(reasons()).toEqual([])
  })

  it('treats a value matching the shared token as the shared token', async () => {
    // Every tenant can see the shared token, so a user token that collided with
    // it must not be honoured: the weaker credential wins, or a copied value
    // would authenticate as whoever it happens to collide with.
    const db = createTestDb()
    addUser(db, 'u-alice')
    const shared = getOrCreateInternalToken(db)
    db.prepare('UPDATE internal_user_token SET token = ? WHERE user_id = ?').run(shared, 'u-alice')

    // Asserted in both directions. "Refused" alone is satisfied by a lookup
    // that simply found nothing, which is the case this test exists to rule
    // out.
    expect(findUserIdByToken(db, shared)).toBe('u-alice')

    const res = await createTestApp(db).request('/test', {
      headers: { authorization: `Bearer ${shared}`, [SESSION_HEADER]: 'ses_placed' },
    })

    expect(res.status).toBe(401)
  })

  it('does not need a session when the credential is a person', async () => {
    // The CLI runs on someone's own machine and is not inside an OpenCode
    // session, so requiring one would lock the one credential that is actually
    // scoped to somebody out.
    const db = createTestDb()
    addUser(db, 'u-alice')
    const res = await createTestApp(db).request('/test', {
      headers: { authorization: `Bearer ${getOrCreateUserToken(db, 'u-alice')}` },
    })

    expect(res.status).toBe(200)
    expect(reasons()).toEqual([])
  })

  it('ignores a session header on a user token', async () => {
    // A user token names its owner. Letting a session header overrule it would
    // hand a caller the identity of any session they could name.
    const db = createTestDb()
    addUser(db, 'u-alice')
    recordAgentSession(db, {
      sessionId: 'ses_bob',
      userId: 'u-bob',
      username: 'bob',
      role: 'admin',
      directory: null,
      source: 'proxy',
    })

    const res = await createTestApp(db).request('/test', {
      headers: { authorization: `Bearer ${getOrCreateUserToken(db, 'u-alice')}`, [SESSION_HEADER]: 'ses_bob' },
    })

    const body = await res.json() as { user: { id: string; role: string } }
    expect(body.user.id).toBe('u-alice')
    expect(body.user.role).toBe('user')
  })

  it('names the method and path so a refused request can be traced', async () => {
    const db = createTestDb()
    await createTestApp(db).request('/test', { headers: asPlugin(db) })

    expect(reasons()[0]).toContain('method=GET')
    expect(reasons()[0]).toContain('path=/test')
  })

  it('marks every line with one prefix so the count is a single grep', async () => {
    const db = createTestDb()
    await createTestApp(db).request('/test', { headers: asPlugin(db) })
    await createTestApp(db).request('/test', { headers: asPlugin(db, 'ses_never_seen') })

    for (const line of reasons()) {
      expect(line.startsWith('[ocm-identity] internal request not attributable:')).toBe(true)
    }
  })
})
