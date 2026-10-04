import type { Migration } from '../migration-runner'

/**
 * A token per user, for the internal API.
 *
 * The single global internal token is the `ocm` plugin's credential: it lives
 * in the OpenCode server's environment, which is one process shared by every
 * tenant, so it can only ever say "this is our plugin". It used to double as
 * the human credential too - the Settings page handed the same global token to
 * anyone who asked, and the `ocm` CLI stored it - which meant any tenant could
 * read every other tenant's repositories and every other tenant's session ids
 * with a single curl.
 *
 * This table is the human half: one token, one person. A request carrying one
 * is that person, full stop, and never has to prove which session it is in.
 */
const migration: Migration = {
  version: 27,
  name: 'internal-user-token',

  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS internal_user_token (
        user_id TEXT PRIMARY KEY NOT NULL,
        token TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)
    // Looked up by token on every internal request, so the index is the point.
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_internal_user_token ON internal_user_token(token)')
  },

  down(db) {
    db.run('DROP INDEX IF EXISTS idx_internal_user_token')
    db.run('DROP TABLE IF EXISTS internal_user_token')
  },
}

export default migration
