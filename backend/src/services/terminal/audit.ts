import type { Database } from 'bun:sqlite'

export interface TerminalAuditEntry {
  id: string
  userId: string
  userEmail: string | null
  ipAddress: string | null
  userAgent: string | null
  shell: string | null
  cwd: string | null
  cols: number | null
  rows: number | null
  startedAt: number
  endedAt: number | null
  exitCode: number | null
  closeReason: string | null
  totalBytes: number
  active: boolean
}

export interface TerminalAuditFilter {
  userId?: string
  email?: string
  active?: boolean
  from?: number
  to?: number
  limit?: number
  offset?: number
}

interface AuditRow {
  id: string
  user_id: string
  user_email: string | null
  ip_address: string | null
  user_agent: string | null
  shell: string | null
  cwd: string | null
  cols: number | null
  rows: number | null
  started_at: number
  ended_at: number | null
  exit_code: number | null
  close_reason: string | null
  total_bytes: number | null
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function toEntry(row: AuditRow): TerminalAuditEntry {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    shell: row.shell,
    cwd: row.cwd,
    cols: row.cols,
    rows: row.rows,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    exitCode: row.exit_code,
    closeReason: row.close_reason,
    totalBytes: row.total_bytes ?? 0,
    active: row.ended_at === null,
  }
}

export function listTerminalAudit(
  db: Database,
  filter: TerminalAuditFilter = {},
): { entries: TerminalAuditEntry[]; total: number } {
  const conditions: string[] = []
  const params: Array<string | number> = []

  if (filter.userId) {
    conditions.push('user_id = ?')
    params.push(filter.userId)
  }
  if (filter.email) {
    conditions.push('lower(user_email) LIKE ?')
    params.push(`%${filter.email.trim().toLowerCase()}%`)
  }
  if (filter.active === true) {
    conditions.push('ended_at IS NULL')
  } else if (filter.active === false) {
    conditions.push('ended_at IS NOT NULL')
  }
  if (typeof filter.from === 'number' && Number.isFinite(filter.from)) {
    conditions.push('started_at >= ?')
    params.push(filter.from)
  }
  if (typeof filter.to === 'number' && Number.isFinite(filter.to)) {
    conditions.push('started_at <= ?')
    params.push(filter.to)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const offset = Math.max(Math.trunc(filter.offset ?? 0), 0)

  const totalRow = db.prepare(`SELECT COUNT(*) as count FROM terminal_audit ${where}`).get(...params) as { count: number }
  const rows = db
    .prepare(
      `SELECT id, user_id, user_email, ip_address, user_agent, shell, cwd, cols, rows,
              started_at, ended_at, exit_code, close_reason, total_bytes
         FROM terminal_audit ${where}
        ORDER BY started_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as AuditRow[]

  return { entries: rows.map(toEntry), total: totalRow.count }
}

export function pruneTerminalAudit(db: Database, before: number): number {
  const result = db.prepare('DELETE FROM terminal_audit WHERE started_at < ?').run(before)
  return Number(result.changes)
}

export function countActiveTerminalSessions(db: Database): number {
  const row = db.prepare('SELECT COUNT(*) as count FROM terminal_audit WHERE ended_at IS NULL').get() as { count: number }
  return row.count
}
