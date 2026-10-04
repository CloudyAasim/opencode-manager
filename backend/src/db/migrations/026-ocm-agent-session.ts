import type { Migration } from '../migration-runner'

/**
 * Which OpenCode session belongs to whom.
 *
 * The internal API is reached by the `ocm` tool with one global bearer token,
 * so a token alone says "this is our plugin" and nothing about who is calling.
 * This table is the other half: the manager creates every OpenCode session
 * itself, so it knows the owner at the moment it is created, and the plugin
 * reports the session id it is running in.
 *
 * Staged rollout. Nothing reads this table yet - the middleware still accepts
 * a bare token - but it is written from day one so that turning enforcement on
 * later is a matter of switching one branch rather than inventing the data
 * under pressure.
 *
 * `directory` is recorded for auditing only. It is deliberately not the
 * identity: scheduled runs execute under `/workspace/schedule-worktrees/...`
 * and admin sessions under `/workspace/repos/...`, neither of which contains
 * a user name, so a directory cannot answer this question for every session.
 */
const migration: Migration = {
  version: 26,
  name: 'ocm-agent-session',

  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS ocm_agent_session (
        session_id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT,
        username TEXT,
        role TEXT NOT NULL,
        directory TEXT,
        source TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)
    db.run('CREATE INDEX IF NOT EXISTS idx_ocm_agent_session_user ON ocm_agent_session(user_id)')
  },

  down(db) {
    db.run('DROP INDEX IF EXISTS idx_ocm_agent_session_user')
    db.run('DROP TABLE IF EXISTS ocm_agent_session')
  },
}

export default migration
