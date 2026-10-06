import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

/**
 * Which configuration a write landed in.
 *
 * `global` is the one file every session on the server reads, so a write to it
 * changed what every tenant sees. `user` is a single tenant's own copy, which
 * nobody else reads. They are separate scopes because they are separate blast
 * radii, and an audit row that cannot say which one it was is the row that gets
 * misread in exactly the situation it exists for.
 */
export type OpenCodeConfigAuditScope = 'global' | 'user'

/**
 * Who made the write.
 *
 * Every field is nullable on purpose. A write that reached the config through a
 * path that carries no session still has to leave a row, and a row that
 * invents an owner is worse than one that admits it has none.
 */
export interface OpenCodeConfigAuditActor {
  userId: string | null
  userEmail: string | null
  ipAddress: string | null
  userAgent: string | null
}

export interface OpenCodeConfigAuditRecord {
  actor: OpenCodeConfigAuditActor
  scope: OpenCodeConfigAuditScope
  /** Whose copy this was, when the scope is `user`. Null for the global one. */
  subject?: string | null
  source?: string | null
  revision?: string | null
  changedKeys: string[]
  details?: Record<string, unknown> | null
  restartPending?: boolean
}

export interface OpenCodeConfigAuditEntry {
  id: string
  userId: string | null
  userEmail: string | null
  ipAddress: string | null
  userAgent: string | null
  scope: OpenCodeConfigAuditScope
  subject: string | null
  source: string | null
  revision: string | null
  changedKeys: string[]
  details: Record<string, unknown> | null
  restartPending: boolean
  createdAt: number
}

export interface OpenCodeConfigAuditFilter {
  userId?: string
  email?: string
  scope?: OpenCodeConfigAuditScope
  from?: number
  to?: number
  limit?: number
  offset?: number
}

interface OpenCodeConfigAuditRow {
  id: string
  user_id: string | null
  user_email: string | null
  ip_address: string | null
  user_agent: string | null
  scope: string
  subject: string | null
  source: string | null
  revision: string | null
  changed_keys: string
  details: string | null
  restart_pending: number
  created_at: number
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export const UNATTRIBUTED_ACTOR: OpenCodeConfigAuditActor = {
  userId: null,
  userEmail: null,
  ipAddress: null,
  userAgent: null,
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * What a write actually changed.
 *
 * Only the top level, on purpose: the file is a nested document and a diff all
 * the way down produces a paragraph nobody reads. `provider` is the one key
 * where the key name alone does not answer the question - adding a provider and
 * rewriting every model of an existing one are the same string - so it carries
 * the ids it added and removed alongside it.
 */
export function diffOpenCodeConfig(
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
): { changedKeys: string[]; details: Record<string, unknown> | null } {
  const before = asRecord(previous)
  const after = asRecord(next)
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changedKeys = [...keys].filter((key) => !isDeepStrictEqual(before[key], after[key])).sort()

  if (!changedKeys.includes('provider')) {
    return { changedKeys, details: null }
  }

  const from = asRecord(before.provider)
  const to = asRecord(after.provider)
  return {
    changedKeys,
    details: {
      provider: {
        added: Object.keys(to).filter((id) => !(id in from)).sort(),
        removed: Object.keys(from).filter((id) => !(id in to)).sort(),
      },
    },
  }
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string')
    }
  } catch {
    // A row written by an older build, or a truncated one. The column is only
    // ever a rendering aid, so an unreadable value is shown as "no keys" rather
    // than failing the whole listing.
  }
  return []
}

function parseDetails(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return asRecord(parsed)
  } catch {
    return null
  }
}

function toEntry(row: OpenCodeConfigAuditRow): OpenCodeConfigAuditEntry {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    scope: row.scope === 'user' ? 'user' : 'global',
    subject: row.subject,
    source: row.source,
    revision: row.revision,
    changedKeys: parseJsonArray(row.changed_keys),
    details: parseDetails(row.details),
    restartPending: row.restart_pending === 1,
    createdAt: row.created_at,
  }
}

export function recordOpenCodeConfigAudit(db: Database, record: OpenCodeConfigAuditRecord): void {
  db.prepare(
    `INSERT INTO opencode_config_audit
      (id, user_id, user_email, ip_address, user_agent, scope, subject, source, revision,
       changed_keys, details, restart_pending, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    record.actor.userId,
    record.actor.userEmail,
    record.actor.ipAddress,
    record.actor.userAgent,
    record.scope,
    record.subject ?? null,
    record.source ?? null,
    record.revision ?? null,
    JSON.stringify(record.changedKeys),
    record.details ? JSON.stringify(record.details) : null,
    record.restartPending ? 1 : 0,
    Date.now(),
  )
}

export function listOpenCodeConfigAudit(
  db: Database,
  filter: OpenCodeConfigAuditFilter = {},
): { entries: OpenCodeConfigAuditEntry[]; total: number } {
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
  if (filter.scope) {
    conditions.push('scope = ?')
    params.push(filter.scope)
  }
  if (typeof filter.from === 'number' && Number.isFinite(filter.from)) {
    conditions.push('created_at >= ?')
    params.push(filter.from)
  }
  if (typeof filter.to === 'number' && Number.isFinite(filter.to)) {
    conditions.push('created_at <= ?')
    params.push(filter.to)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const offset = Math.max(Math.trunc(filter.offset ?? 0), 0)

  const totalRow = db.prepare(`SELECT COUNT(*) as count FROM opencode_config_audit ${where}`).get(...params) as {
    count: number
  }
  const rows = db
    .prepare(
      `SELECT id, user_id, user_email, ip_address, user_agent, scope, subject, source, revision,
              changed_keys, details, restart_pending, created_at
         FROM opencode_config_audit ${where}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as OpenCodeConfigAuditRow[]

  return { entries: rows.map(toEntry), total: totalRow.count }
}

export function pruneOpenCodeConfigAudit(db: Database, before: number): number {
  const result = db.prepare('DELETE FROM opencode_config_audit WHERE created_at < ?').run(before)
  return Number(result.changes)
}
