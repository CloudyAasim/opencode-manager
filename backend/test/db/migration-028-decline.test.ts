import { describe, it, expect } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate, MigrationDeclinedError } from '../../src/db/migration-runner'
import migration028 from '../../src/db/migrations/028-repos-uniqueness-per-user'

/**
 * The decline path of migration 28, which nothing else covers.
 *
 * The other tests for this migration exercise `down()`. Its `up()` declined by
 * returning normally, which is the one thing a migration runner cannot tell
 * from success - so it recorded the migration as applied, and the indexes that
 * fix the original bug were never created while the database insisted they
 * were. The only trace was one line in a container log.
 *
 * `migrate()` already has tests for what it does with a decline, using
 * synthetic migrations. What was missing is the check that this migration
 * actually raises one, which is why reverting it to a bare `return` left the
 * whole suite green.
 *
 * A minimal `repos` table rather than the full migration set: the guard only
 * reads four columns, and building the table by hand is what lets the test
 * create the state the guard exists for - duplicate rows among shared repos,
 * which migration 4's global index makes impossible to reach normally.
 */

function makeDb(): Database {
  const db = new Database(':memory:')
  db.run(`
    CREATE TABLE repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_url TEXT,
      local_path TEXT,
      branch TEXT,
      user_id TEXT
    )
  `)
  // The pre-28 shape: uniqueness is global, which is what makes the duplicate
  // rows below something an operator has to clean up by hand.
  db.run('CREATE UNIQUE INDEX idx_local_path ON repos(local_path)')
  db.run('CREATE UNIQUE INDEX idx_repo_url_branch ON repos(repo_url, branch)')
  return db
}

function addSharedRow(db: Database, repoUrl: string, localPath: string, branch: string | null = null): void {
  db.prepare('INSERT INTO repos (repo_url, local_path, branch, user_id) VALUES (?, ?, ?, NULL)')
    .run(repoUrl, localPath, branch)
}

function recorded(db: Database, version: number): unknown {
  return db.prepare('SELECT version, name FROM schema_migrations WHERE version = ?').get(version)
}

function declineFrom(db: Database): Error {
  try {
    migration028.up(db)
  } catch (error) {
    return error as Error
  }
  throw new Error('expected migration 028 to decline')
}

describe('migration 028 refuses to run rather than pretending it did', () => {
  it('raises a decline, not a return, when shared repos already share a directory name', () => {
    const db = makeDb()
    // The global index is what stops this happening, so it has to be dropped
    // to reproduce a database that got here another way.
    db.run('DROP INDEX idx_local_path')
    addSharedRow(db, 'https://example.test/one.git', 'shared-name')
    addSharedRow(db, 'https://example.test/two.git', 'shared-name')

    // A bare `return` here is indistinguishable from success to the runner.
    const error = declineFrom(db)
    expect(error).toBeInstanceOf(MigrationDeclinedError)
    expect(error.message).toMatch(/shared-name/)
    // Names the row, so whoever has to fix it does not have to go looking.
    expect(error.message).toMatch(/resolve these rows and restart/)
  })

  it('raises a decline when shared repos already share a url and branch', () => {
    const db = makeDb()
    db.run('DROP INDEX idx_repo_url_branch')
    const url = 'https://example.test/same.git'
    addSharedRow(db, url, 'one', 'main')
    addSharedRow(db, url, 'two', 'main')

    const error = declineFrom(db)
    expect(error).toBeInstanceOf(MigrationDeclinedError)
    expect(error.message).toMatch(/same\.git'#main/)
  })

  it('is not recorded as applied when the runner hits the duplicates', () => {
    const db = makeDb()
    db.run('DROP INDEX idx_local_path')
    addSharedRow(db, 'https://example.test/one.git', 'shared-name')
    addSharedRow(db, 'https://example.test/two.git', 'shared-name')

    migrate(db, [migration028])

    // The whole point. Recorded means done, and nothing ever retries.
    expect(recorded(db, 28)).toBeUndefined()
  })

  it('leaves the previous global indexes in force, so nothing is half-changed', () => {
    const db = makeDb()
    db.run('DROP INDEX idx_local_path')
    addSharedRow(db, 'https://example.test/one.git', 'shared-name')
    addSharedRow(db, 'https://example.test/two.git', 'shared-name')

    expect(declineFrom(db)).toBeInstanceOf(MigrationDeclinedError)

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]
    expect(indexes.map((row) => row.name)).toContain('idx_repo_url_branch')
    expect(indexes.map((row) => row.name)).not.toContain('idx_local_path_shared')
  })

  it('still applies cleanly once the duplicates are gone', () => {
    const db = makeDb()
    addSharedRow(db, 'https://example.test/one.git', 'only-one')

    migrate(db, [migration028])

    expect(recorded(db, 28)).toEqual({ version: 28, name: 'repos-uniqueness-per-user' })
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]
    const names = indexes.map((row) => row.name)
    expect(names).toContain('idx_local_path_shared')
    expect(names).toContain('idx_repo_url_branch_shared')
  })
})
