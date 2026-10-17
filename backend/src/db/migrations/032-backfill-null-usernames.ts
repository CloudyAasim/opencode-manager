import type { Migration } from '../migration-runner'
import { deriveUsernameFromEmail, uniquifyUsername } from '@opencode-manager/shared/utils'

/**
 * Migration 023 backfilled `username` for the accounts that existed when it
 * ran. Nothing ever assigned one afterwards: the field is declared
 * `input: false`, so a client cannot supply it, and no hook set it. So every
 * account created since landed with `NULL` - and a null username is the key for
 * every per-user directory on disk.
 *
 * Sign-up now derives one (see the `create.before` hook in `src/auth/index.ts`).
 * This covers the rows that already exist.
 *
 * The derivation is the shared one, the same the admin user service uses, so
 * that the same email cannot come out with different usernames depending on
 * which of the three paths wrote the row.
 */
const migration: Migration = {
  version: 32,
  name: 'backfill-null-usernames',

  up(db) {
    const rows = db
      .prepare('SELECT id, email, username FROM "user"')
      .all() as { id: string; email: string; username: string | null }[]

    const taken = new Set<string>()
    for (const row of rows) {
      const existing = row.username?.trim().toLowerCase()
      if (existing) taken.add(existing)
    }

    for (const row of rows) {
      if (row.username?.trim()) continue
      const username = uniquifyUsername(deriveUsernameFromEmail(row.email || row.id), (c) => taken.has(c))
      taken.add(username)
      db.prepare('UPDATE "user" SET username = ? WHERE id = ?').run(username, row.id)
    }
  },

  down() {
    // Nothing to undo: the username is a per-user directory key, and blanking
    // the ones this added would send those accounts back to the shared
    // server-global directory.
  },
}

export default migration
