import type { Migration } from '../migration-runner'

const migration: Migration = {
  version: 25,
  name: 'schedule-run-status-index',

  up(db) {
    db.run("CREATE INDEX IF NOT EXISTS idx_schedule_runs_status ON schedule_runs(status, started_at DESC)")
  },

  down(db) {
    db.run('DROP INDEX IF EXISTS idx_schedule_runs_status')
  },
}

export default migration
