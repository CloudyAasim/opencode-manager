import type { Migration } from '../migration-runner'

const USERNAME_MAX_LENGTH = 32
const RESERVED = new Set([
  'repos', 'users', 'user', 'config', 'configuration', 'data', 'cache', 'system', 'root',
  'admin', 'administrator', 'opencode', 'assistant', 'schedule', 'schedules', 'scheduled',
  'worktrees', 'schedule-worktrees', 'api', 'auth', 'login', 'logout', 'settings', 'assets',
  'static', 'public', 'null', 'undefined', 'me', 'self', 'anonymous', 'guest', 'tmp', 'temp',
])

function sanitize(raw: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  const started = /^[a-z]/.test(cleaned) ? cleaned : `u${cleaned}`
  const bounded = started.slice(0, USERNAME_MAX_LENGTH)
  return bounded.length >= 3 ? bounded : `${bounded}user`.slice(0, USERNAME_MAX_LENGTH)
}

function fromEmail(email: string): string {
  const localPart = email.includes('@') ? email.slice(0, email.indexOf('@')) : email
  return sanitize(localPart)
}

function unique(base: string, taken: Set<string>): string {
  const candidate = sanitize(base)
  if (!RESERVED.has(candidate) && !taken.has(candidate)) return candidate
  for (let suffix = 2; suffix < 100000; suffix += 1) {
    const text = String(suffix)
    const next = `${candidate.slice(0, USERNAME_MAX_LENGTH - text.length)}${text}`
    if (next.length >= 3 && !RESERVED.has(next) && !taken.has(next)) return next
  }
  return candidate
}

const migration: Migration = {
  version: 23,
  name: 'user-username',

  up(db) {
    const columns = db.prepare('PRAGMA table_info("user")').all() as { name: string }[]
    if (!columns.some((column) => column.name === 'username')) {
      db.run('ALTER TABLE "user" ADD COLUMN username TEXT')
    }

    const rows = db
      .prepare('SELECT id, email, username FROM "user"')
      .all() as { id: string; email: string; username: string | null }[]

    const taken = new Set<string>()
    for (const row of rows) {
      const existing = row.username?.trim().toLowerCase()
      if (existing) {
        taken.add(existing)
      }
    }

    for (const row of rows) {
      const existing = row.username?.trim().toLowerCase()
      if (existing) continue
      const username = unique(fromEmail(row.email || row.id), taken)
      taken.add(username)
      db.prepare('UPDATE "user" SET username = ? WHERE id = ?').run(username, row.id)
    }

    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_user_username ON "user"(username)')
  },

  down(db) {
    db.run('DROP INDEX IF EXISTS idx_user_username')
  },
}

export default migration
