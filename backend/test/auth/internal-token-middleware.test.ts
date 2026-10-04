import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { createInternalTokenMiddleware, SESSION_HEADER } from '../../src/auth/internal-token-middleware'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { recordAgentSession } from '../../src/services/agent-session'
import { logger } from '../../src/utils/logger'
import migration013 from '../../src/db/migrations/013-app-secrets'
import migration026 from '../../src/db/migrations/026-ocm-agent-session'

describe('internal-token-middleware', () => {
  function createTestDb(): Database {
    const db = new Database(':memory:')
    migration013.up(db)
    // 026 stands alone: no foreign keys, nothing it depends on.
    migration026.up(db)
    return db
  }

  function createTestApp(db: Database) {
    const app = new Hono()
    app.use('/*', createInternalTokenMiddleware(db))
    app.get('/test', (c) => c.json({ ok: true }))
    return app
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
    const validToken = getOrCreateInternalToken(db)
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

  it('returns 200 when bearer token matches', async () => {
    const db = createTestDb()
    const token = getOrCreateInternalToken(db)
    const app = createTestApp(db)
    const res = await app.request('/test', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  })

  it('returns 401 when basic auth password is wrong', async () => {
    const db = createTestDb()
    const app = createTestApp(db)
    const res = await app.request('/test', {
      headers: { authorization: 'Basic ' + Buffer.from('opencode:wrong-password').toString('base64') },
    })
    expect(res.status).toBe(401)
  })

  it('returns 200 when basic auth password matches internal token', async () => {
    const db = createTestDb()
    const token = getOrCreateInternalToken(db)
    const app = createTestApp(db)
    const res = await app.request('/test', {
      headers: { authorization: 'Basic ' + Buffer.from(`opencode:${token}`).toString('base64') },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  })
})

/**
 * Shadow mode: the middleware counts the internal requests that arrive with no
 * tenant attached and lets every single one through. These tests exist so that
 * "lets through" cannot quietly become "blocks" by accident, and so the count
 * itself is trustworthy.
 */
describe('internal-token-middleware identity shadow check', () => {
  let warn: ReturnType<typeof vi.spyOn>

  function createTestDb(): Database {
    const db = new Database(':memory:')
    migration013.up(db)
    migration026.up(db)
    return db
  }

  function createTestApp(db: Database) {
    const app = new Hono()
    app.use('/*', createInternalTokenMiddleware(db))
    app.get('/test', (c) => c.json({ ok: true }))
    return app
  }

  function authed(db: Database, sessionId?: string) {
    const headers: Record<string, string> = { authorization: `Bearer ${getOrCreateInternalToken(db)}` }
    if (sessionId !== undefined) headers[SESSION_HEADER] = sessionId
    return headers
  }

  const reasons = () => warn.mock.calls.map((call) => String(call[0]))

  beforeEach(() => {
    warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
  })

  it('lets an unlabelled request through and says why it could not be placed', async () => {
    const db = createTestDb()
    const res = await createTestApp(db).request('/test', { headers: authed(db) })

    // This is the whole point of the stage: nothing is refused yet, the gap
    // is only counted.
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(reasons()).toHaveLength(1)
    expect(reasons()[0]).toContain('reason=no-session-header')
  })

  it('stays quiet about a request it can place', async () => {
    // Without this the count would be unreadable: every placed request would
    // add a line and the number being measured would disappear into the noise.
    const db = createTestDb()
    recordAgentSession(db, {
      sessionId: 'ses_placed',
      userId: 'u-alice',
      username: 'alice',
      role: 'user',
      directory: '/workspace/users/alice/workspace',
      source: 'proxy',
    })

    const res = await createTestApp(db).request('/test', { headers: authed(db, 'ses_placed') })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(reasons()).toEqual([])
  })

  it('reports a session nobody has heard of', async () => {
    const db = createTestDb()
    const res = await createTestApp(db).request('/test', { headers: authed(db, 'ses_never_seen') })

    expect(res.status).toBe(200)
    expect(reasons()[0]).toContain('reason=unknown-session')
    expect(reasons()[0]).toContain('session=ses_never_seen')
  })

  it('reports a session with nobody attached to it', async () => {
    // A schedule on an unowned repository lands here. Reporting it is the
    // point: it is a real gap, and pretending otherwise would quietly hand
    // the session to a neighbour later.
    const db = createTestDb()
    recordAgentSession(db, {
      sessionId: 'ses_ownerless',
      userId: null,
      username: null,
      role: 'unknown',
      directory: '/workspace/schedule-worktrees/job-7-run-5',
      source: 'schedule',
    })

    const res = await createTestApp(db).request('/test', { headers: authed(db, 'ses_ownerless') })

    expect(res.status).toBe(200)
    expect(reasons()[0]).toContain('reason=no-user')
  })

  it('treats a blank session header as no header at all', async () => {
    // HTTP trims header values on the way in, so this only ever proves the
    // classification: a blank id must land in the "no header" bucket rather
    // than being looked up and reported as an unknown session.
    const db = createTestDb()
    for (const blank of ['', '   ']) {
      warn.mockClear()
      const res = await createTestApp(db).request('/test', { headers: authed(db, blank) })
      expect(res.status).toBe(200)
      expect(reasons()[0]).toContain('reason=no-session-header')
    }
  })

  it('says nothing about a request the token already rejected', async () => {
    // A request that never got in has no session worth counting, and counting
    // it would make the metric describe auth failures instead of identity gaps.
    const db = createTestDb()
    const res = await createTestApp(db).request('/test', {
      headers: { authorization: 'Bearer wrong', [SESSION_HEADER]: 'ses_never_seen' },
    })

    expect(res.status).toBe(401)
    expect(reasons()).toEqual([])
  })

  it('names the method and path so an unplaceable request can be traced', async () => {
    const db = createTestDb()
    await createTestApp(db).request('/test', { headers: authed(db) })

    expect(reasons()[0]).toContain('method=GET')
    expect(reasons()[0]).toContain('path=/test')
  })

  it('marks every line with one prefix so the count is a single grep', async () => {
    const db = createTestDb()
    await createTestApp(db).request('/test', { headers: authed(db) })
    await createTestApp(db).request('/test', { headers: authed(db, 'ses_never_seen') })

    for (const line of reasons()) {
      expect(line.startsWith('[ocm-identity] internal request not attributable:')).toBe(true)
    }
  })
})
