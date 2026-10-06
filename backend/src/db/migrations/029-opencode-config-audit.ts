import type { Migration } from '../migration-runner'

const migration: Migration = {
  version: 29,
  name: 'opencode-config-audit',

  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS opencode_config_audit (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT,
        user_email TEXT,
        ip_address TEXT,
        user_agent TEXT,
        scope TEXT NOT NULL,
        subject TEXT,
        source TEXT,
        revision TEXT,
        changed_keys TEXT NOT NULL,
        details TEXT,
        restart_pending INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `)

    db.run('CREATE INDEX IF NOT EXISTS idx_opencode_config_audit_created ON opencode_config_audit(created_at)')
    db.run('CREATE INDEX IF NOT EXISTS idx_opencode_config_audit_user ON opencode_config_audit(user_id)')
  },

  down(db) {
    db.run('DROP TABLE IF EXISTS opencode_config_audit')
  },
}

export default migration
