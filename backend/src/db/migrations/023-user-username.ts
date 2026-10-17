import type { Migration } from '../migration-runner'
import { assignUsername } from '../../auth/username'

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
      const username = assignUsername(row.email || row.id, taken)
      db.prepare('UPDATE "user" SET username = ? WHERE id = ?').run(username, row.id)
    }

    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_user_username ON "user"(username)')
  },

  down(db) {
    db.run('DROP INDEX IF EXISTS idx_user_username')
  },
}

export default migration
