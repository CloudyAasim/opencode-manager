import type { Migration } from '../migration-runner'

/**
 * Drops the table the per-user provider declaration feature used.
 *
 * The migration that created it is gone from the tree, but it already ran on
 * every deployed database - a migration cannot be un-run by deleting the file,
 * and the runner only warns about a version it has a record of and no code for,
 * so the table would otherwise sit there forever with nothing reading or
 * writing it.
 *
 * What was in it is acknowledgements of a prompt that no longer exists.
 */
const migration: Migration = {
  version: 31,
  name: 'drop-provider-conflict-ack',
  up(db) {
    db.run('DROP TABLE IF EXISTS provider_conflict_ack')
  },
  down(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS provider_conflict_ack (
        username TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        global_fingerprint TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (username, provider_id)
      )
    `)
  },
}

export default migration