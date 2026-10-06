import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { createAuditRoutes } from '../../src/routes/admin-audit'
import { listTerminalAudit } from '../../src/services/terminal/audit'
import { listOpenCodeConfigAudit } from '../../src/services/opencode-config-audit'
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

function insertConfigAudit(
  db: Database,
  id: string,
  createdAt: number,
  overrides: { scope?: 'global' | 'user'; subject?: string; changedKeys?: string[] } = {},
) {
  db.prepare(
    `INSERT INTO opencode_config_audit
      (id, user_id, user_email, ip_address, user_agent, scope, subject, source, revision, changed_keys, details, restart_pending, created_at)
     VALUES (?, 'u1', 'one@example.com', '203.0.113.10', 'vitest', ?, ?, 'opencode.json', 'rev-1', ?, NULL, 0, ?)`,
  ).run(
    id,
    overrides.scope ?? 'global',
    overrides.subject ?? null,
    JSON.stringify(overrides.changedKeys ?? ['theme']),
    createdAt,
  )
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
    const res = await createApp(db, 'admin').request('/prune', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ before: 'nope' }),
    })

    expect(res.status).toBe(400)
  })

  it('prunes both tables in one action and reports each of them', async () => {
    insertConfigAudit(db, 'c1', 1000)
    insertConfigAudit(db, 'c2', 2500)

    const res = await createApp(db, 'admin').request('/prune', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ before: 1800 }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ terminal: 1, config: 1, deleted: 2 })
    // A prune that only cleared the terminal half would have answered 1 and
    // left the rows an admin was told were gone still on disk.
    expect(listTerminalAudit(db).entries.map((entry) => entry.id)).toEqual(['a2'])
    expect(listOpenCodeConfigAudit(db).entries.map((entry) => entry.id)).toEqual(['c2'])
  })

  describe('opencode config audit', () => {
    beforeEach(() => {
      insertConfigAudit(db, 'c1', 1000, { scope: 'global', changedKeys: ['theme'] })
      insertConfigAudit(db, 'c2', 2000, { scope: 'user', subject: 'alice', changedKeys: ['provider'] })
    })

    it('rejects non-admins', async () => {
      const res = await createApp(db, 'user').request('/opencode-config')
      expect(res.status).toBe(403)
    })

    it('lists config writes newest first', async () => {
      const res = await createApp(db, 'admin').request('/opencode-config')
      const body = await res.json() as { entries: Array<{ id: string; changedKeys: string[]; scope: string }>; total: number }

      expect(res.status).toBe(200)
      expect(body.total).toBe(2)
      expect(body.entries.map((entry) => entry.id)).toEqual(['c2', 'c1'])
      expect(body.entries[0]).toMatchObject({ scope: 'user', subject: 'alice', changedKeys: ['provider'] })
    })

    it('filters by scope and by email', async () => {
      const scoped = await (await createApp(db, 'admin').request('/opencode-config?scope=global')).json() as { total: number }
      // Both rows are `one@example.com`; the uppercase form proves the match is
      // case-insensitive rather than a lucky exact hit.
      const byEmail = await (await createApp(db, 'admin').request('/opencode-config?email=ONE@EXAMPLE')).json() as { total: number }
      const nobody = await (await createApp(db, 'admin').request('/opencode-config?email=nobody')).json() as { total: number }

      expect(scoped.total).toBe(1)
      expect(byEmail.total).toBe(2)
      expect(nobody.total).toBe(0)
    })

    it('rejects an unknown scope rather than ignoring it', async () => {
      const res = await createApp(db, 'admin').request('/opencode-config?scope=everything')
      expect(res.status).toBe(400)
    })
  })
})
