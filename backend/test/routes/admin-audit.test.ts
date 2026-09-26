import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { createAuditRoutes } from '../../src/routes/admin-audit'
import { createTestDb } from '../helpers/assistant-workspace'
import { createSessionUser } from '../helpers/session-user'
import type { Session } from '../../src/auth'

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

function createApp(db: Database, role: 'admin' | 'user') {
  const root = new Hono<{ Variables: { user: Session['user']; session: Session['session'] } }>()
  root.use('/*', async (c, next) => {
    c.set('user', createSessionUser(role))
    c.set('session', { id: 'session-1' } as Session['session'])
    await next()
  })
  root.route('/', createAuditRoutes(db) as unknown as Hono)
  return root
}

function insertAudit(db: Database, id: string, startedAt: number, endedAt: number | null) {
  db.prepare(
    `INSERT INTO terminal_audit
      (id, user_id, user_email, ip_address, user_agent, shell, cwd, cols, rows, started_at, ended_at, exit_code, close_reason, total_bytes)
     VALUES (?, 'u1', 'one@example.com', '203.0.113.10', 'vitest', '/bin/bash', '/workspace/users/x', 120, 30, ?, ?, NULL, NULL, 10)`,
  ).run(id, startedAt, endedAt)
}

describe('admin audit routes', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    db = createTestDb()
    insertAudit(db, 'a1', 1000, 1500)
    insertAudit(db, 'a2', 2000, null)
  })

  afterEach(() => {
    db.close()
  })

  it('rejects non-admins', async () => {
    const res = await createApp(db, 'user').request('/terminal')
    expect(res.status).toBe(403)
  })

  it('lists terminal audit entries for admins', async () => {
    const res = await createApp(db, 'admin').request('/terminal')
    const body = await res.json() as { entries: Array<{ id: string }>; total: number }

    expect(res.status).toBe(200)
    expect(body.total).toBe(2)
    expect(body.entries.map((entry) => entry.id)).toEqual(['a2', 'a1'])
  })

  it('applies query filters', async () => {
    const res = await createApp(db, 'admin').request('/terminal?active=true')
    const body = await res.json() as { entries: Array<{ id: string }> }

    expect(body.entries.map((entry) => entry.id)).toEqual(['a2'])
  })

  it('rejects invalid prune payloads', async () => {
    const res = await createApp(db, 'admin').request('/terminal/prune', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ before: 'nope' }),
    })

    expect(res.status).toBe(400)
  })

  it('prunes audit entries before the cutoff', async () => {
    const res = await createApp(db, 'admin').request('/terminal/prune', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ before: 1800 }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: 1 })
  })
})
