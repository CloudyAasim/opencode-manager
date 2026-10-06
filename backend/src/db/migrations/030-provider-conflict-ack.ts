import type { Migration } from '../migration-runner'

const migration: Migration = {
  version: 30,
  name: 'provider-conflict-ack',

  up(db) {
    // "I have seen that an administrator declared this id too, and I am
    // keeping mine." One row per tenant per id, holding the fingerprint of the
    // global entry that was on screen when they said so.
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

  down(db) {
    db.run('DROP TABLE IF EXISTS provider_conflict_ack')
  },
}

export default migration
