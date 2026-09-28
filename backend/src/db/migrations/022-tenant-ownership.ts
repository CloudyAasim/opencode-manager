import type { Migration } from '../migration-runner'
import type { Database } from 'bun:sqlite'

function hasColumn(db: Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return rows.some((row) => row.name === column)
}

function addColumn(db: Database, table: string, column: string, ddl: string): void {
  if (!hasColumn(db, table, column)) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`)
  }
}

function firstUserId(db: Database): string | null {
  const admin = db
    .prepare(`SELECT id FROM "user" WHERE role = 'admin' ORDER BY createdAt ASC LIMIT 1`)
    .get() as { id: string } | undefined
  if (admin) return admin.id
  const any = db.prepare('SELECT id FROM "user" ORDER BY createdAt ASC LIMIT 1').get() as { id: string } | undefined
  return any?.id ?? null
}

const migration: Migration = {
  version: 22,
  name: 'tenant-ownership',

  up(db) {
    addColumn(db, 'repos', 'user_id', 'TEXT')
    addColumn(db, 'session_pins', 'user_id', 'TEXT')
    addColumn(db, 'prompt_templates', 'user_id', 'TEXT')

    db.run('CREATE INDEX IF NOT EXISTS idx_repos_user ON repos(user_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_session_pins_user ON session_pins(user_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_prompt_templates_user ON prompt_templates(user_id)')

    const owner = firstUserId(db)
    if (!owner) return

    db.prepare('UPDATE repos SET user_id = ? WHERE user_id IS NULL').run(owner)
    db.prepare('UPDATE session_pins SET user_id = ? WHERE user_id IS NULL').run(owner)

    const ownerHasPrefs = db.prepare('SELECT 1 FROM user_preferences WHERE user_id = ?').get(owner)
    if (!ownerHasPrefs) {
      db.prepare('UPDATE user_preferences SET user_id = ? WHERE user_id = ?').run(owner, 'default')
    }

  },

  down(db) {
    db.run('DROP INDEX IF EXISTS idx_prompt_templates_user')
    db.run('DROP INDEX IF EXISTS idx_session_pins_user')
    db.run('DROP INDEX IF EXISTS idx_repos_user')
  },
}

export default migration
