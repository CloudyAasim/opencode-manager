import path from 'node:path'
import type { Migration } from '../migration-runner'
import { DEFAULTS } from '@opencode-manager/shared/config/defaults'

const migration: Migration = {
  version: 24,
  name: 'repo-source-path-backfill',

  up(db) {
    const rows = db
      .prepare("SELECT id, local_path FROM repos WHERE source_path IS NULL OR source_path = ''")
      .all() as { id: number; local_path: string }[]

    const workspaceRoot = process.env.WORKSPACE_PATH
      ? path.resolve(process.env.WORKSPACE_PATH)
      : path.resolve(DEFAULTS.WORKSPACE.BASE_PATH)
    const base = path.join(workspaceRoot, DEFAULTS.WORKSPACE.REPOS_DIR)

    const update = db.prepare('UPDATE repos SET source_path = ? WHERE id = ?')
    for (const row of rows) {
      update.run(path.join(base, row.local_path), row.id)
    }
  },

  down() {},
}

export default migration
