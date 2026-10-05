import { Database } from 'bun:sqlite'
import { logger } from '../utils/logger'

export interface Migration {
  version: number
  name: string
  up(db: Database): void
  down(db: Database): void
}

/**
 * Thrown by a migration whose precondition is not met, and which should be
 * tried again later.
 *
 * Deliberately distinct from an ordinary failure. An ordinary failure means
 * the migration is broken or the database is; rolling back and rethrowing, so
 * the server refuses to start on a schema it does not understand, is right.
 *
 * A decline means "not yet": rows an operator still has to resolve. Rethrowing
 * would turn a fixable data problem into an outage. But simply returning was
 * worse - the runner cannot tell that from success, so it recorded the
 * migration as applied, and a migration recorded as applied is never run
 * again. The constraint it exists to create was silently never created, and
 * the only trace was one line in a container log.
 *
 * So: roll back, do not record it, do not rethrow, and stop the run - later
 * migrations may depend on this one. The next start tries again.
 */
export class MigrationDeclinedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MigrationDeclinedError'
  }
}

export function isMigrationDeclined(error: unknown): error is MigrationDeclinedError {
  return error instanceof MigrationDeclinedError
}

interface MigrationRecord {
  version: number
  name: string
  applied_at: number
}

function ensureMigrationsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `)
}

function getAppliedMigrations(db: Database): Map<number, string> {
  const rows = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all() as MigrationRecord[]
  return new Map(rows.map(r => [r.version, r.name]))
}

function warnOnVersionNameMismatch(applied: Map<number, string>, migrations: Migration[]): void {
  for (const migration of migrations) {
    const recordedName = applied.get(migration.version)
    if (recordedName !== undefined && recordedName !== migration.name) {
      logger.warn(
        `Migration version ${migration.version} is recorded as "${recordedName}" but the code defines "${migration.name}". ` +
        `This migration was skipped; its schema changes may be missing. Verify the database schema and apply the changes manually if needed.`,
      )
    }
  }
}

function markApplied(db: Database, migration: Migration): void {
  db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
    .run(migration.version, migration.name, Date.now())
}

export function migrate(db: Database, migrations: Migration[]): void {
  ensureMigrationsTable(db)

  const applied = getAppliedMigrations(db)
  warnOnVersionNameMismatch(applied, migrations)
  const sorted = [...migrations].sort((a, b) => a.version - b.version)
  const pending = sorted.filter(m => !applied.has(m.version))

  if (pending.length === 0) {
    logger.info('Database schema is up to date')
    return
  }

  logger.info(`Running ${pending.length} pending migration(s)`)

  let declined: { migration: Migration; reason: MigrationDeclinedError } | null = null

  for (const migration of pending) {
    if (declined) break
    logger.info(`Applying migration ${migration.version}: ${migration.name}`)
    db.run('BEGIN TRANSACTION')
    try {
      migration.up(db)
      markApplied(db, migration)
      db.run('COMMIT')
      logger.info(`Migration ${migration.version} applied successfully`)
    } catch (error) {
      db.run('ROLLBACK')
      if (isMigrationDeclined(error)) {
        // Not recorded, not rethrown, and the run stops here rather than
        // applying later migrations on top of a schema that is missing this
        // one.
        logger.error(`Migration ${migration.version} was declined and has NOT been recorded as applied.`)
        declined = { migration, reason: error }
        continue
      }
      logger.error(`Migration ${migration.version} failed:`, error)
      throw error
    }
  }

  if (declined) {
    logger.warn(
      `Stopped at migration ${declined.migration.version} (${declined.migration.name}). It was not recorded as ` +
      `applied and will be retried on the next start; later migrations were skipped because they may depend ` +
      `on it. The server is running on the schema as it was before this migration. Reason: ${declined.reason.message}`,
    )
    return
  }

  logger.info('All migrations applied successfully')
}


