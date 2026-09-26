import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Database } from 'bun:sqlite'
import { createTestDb } from '../helpers/assistant-workspace'
import { countActiveTerminalSessions, listTerminalAudit, pruneTerminalAudit } from '../../src/services/terminal/audit'

function insertAudit(db: Database, row: {
  id: string
  userId: string
  email: string
  startedAt: number
  endedAt?: number | null
  reason?: string | null
  exitCode?: number | null
}) {
  db.prepare(
    `INSERT INTO terminal_audit
      (id, user_id, user_email, ip_address, user_agent, shell, cwd, cols, rows, started_at, ended_at, exit_code, close_reason, total_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.userId,
    row.email,
    '203.0.113.10',
    'vitest',
    '/bin/bash',
    '/workspace/users/x',
    120,
    30,
    row.startedAt,
    row.endedAt ?? null,
    row.exitCode ?? null,
    row.reason ?? null,
    1024,
  )
}

describe('terminal audit queries', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    db = createTestDb()
    insertAudit(db, { id: 'a1', userId: 'u1', email: 'one@example.com', startedAt: 1000 })
    insertAudit(db, { id: 'a2', userId: 'u1', email: 'one@example.com', startedAt: 2000, endedAt: 2500, reason: 'user-closed', exitCode: 0 })
    insertAudit(db, { id: 'a3', userId: 'u2', email: 'two@example.com', startedAt: 3000, endedAt: 3200, reason: 'process-exited', exitCode: 1 })
  })

  afterEach(() => {
    db.close()
  })

  it('lists newest first with an active flag', () => {
    const { entries, total } = listTerminalAudit(db)

    expect(total).toBe(3)
    expect(entries.map((entry) => entry.id)).toEqual(['a3', 'a2', 'a1'])
    expect(entries.find((entry) => entry.id === 'a1')?.active).toBe(true)
    expect(entries.find((entry) => entry.id === 'a2')?.active).toBe(false)
    expect(entries.find((entry) => entry.id === 'a3')?.exitCode).toBe(1)
  })

  it('filters by user id, email and active state', () => {
    expect(listTerminalAudit(db, { userId: 'u1' }).total).toBe(2)
    expect(listTerminalAudit(db, { email: 'two@' }).entries[0]?.id).toBe('a3')
    expect(listTerminalAudit(db, { active: true }).entries.map((entry) => entry.id)).toEqual(['a1'])
    expect(listTerminalAudit(db, { active: false }).total).toBe(2)
  })

  it('filters by time range', () => {
    expect(listTerminalAudit(db, { from: 2000, to: 3000 }).entries.map((entry) => entry.id)).toEqual(['a3', 'a2'])
  })

  it('paginates while reporting the unfiltered-by-page total', () => {
    const page = listTerminalAudit(db, { limit: 1, offset: 1 })

    expect(page.total).toBe(3)
    expect(page.entries).toHaveLength(1)
    expect(page.entries[0]?.id).toBe('a2')
  })

  it('counts active sessions', () => {
    expect(countActiveTerminalSessions(db)).toBe(1)
  })

  it('prunes rows older than the cutoff', () => {
    const deleted = pruneTerminalAudit(db, 2500)

    expect(deleted).toBe(2)
    expect(listTerminalAudit(db).total).toBe(1)
    expect(listTerminalAudit(db).entries[0]?.id).toBe('a3')
  })
})
