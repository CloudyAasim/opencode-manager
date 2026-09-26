import type { Migration } from '../migration-runner'

const migration: Migration = {
  version: 21,
  name: 'terminal-audit',

  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS terminal_audit (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        user_email TEXT,
        ip_address TEXT,
        user_agent TEXT,
        shell TEXT,
        cwd TEXT,
        cols INTEGER,
        rows INTEGER,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        exit_code INTEGER,
        close_reason TEXT,
        total_bytes INTEGER DEFAULT 0
      )
    `)

    db.run('CREATE INDEX IF NOT EXISTS idx_terminal_audit_user ON terminal_audit(user_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_terminal_audit_started ON terminal_audit(started_at)')
  },

  down(db) {
    db.run('DROP TABLE IF EXISTS terminal_audit')
  },
}

export default migration
