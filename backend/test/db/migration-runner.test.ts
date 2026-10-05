import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { migrate, MigrationDeclinedError, type Migration } from '../../src/db/migration-runner'
import { logger } from '../../src/utils/logger'

function makeMigration(version: number, name: string, up: () => void): Migration {
  return { version, name, up, down: () => {} }
}

describe('migrate - version/name mismatch guard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('warns and skips when an applied version was recorded under a different name', () => {
    const db = new Database(':memory:')
    db.run('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)')
    db.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (15, 'repos-add-name', 0)")

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const up = vi.fn()

    migrate(db, [makeMigration(15, 'schedule-worktree-isolation', up)])

    expect(up).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Migration version 15 is recorded as "repos-add-name" but the code defines "schedule-worktree-isolation"'),
    )
  })

  it('does not warn when recorded names match', () => {
    const db = new Database(':memory:')
    db.run('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)')
    db.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (15, 'schedule-worktree-isolation', 0)")

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})

    migrate(db, [makeMigration(15, 'schedule-worktree-isolation', vi.fn())])

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('applies pending migrations and records them', () => {
    const db = new Database(':memory:')
    const up = vi.fn()

    migrate(db, [makeMigration(1, 'base', up)])

    expect(up).toHaveBeenCalledTimes(1)
    const row = db.prepare('SELECT version, name FROM schema_migrations WHERE version = 1').get() as { version: number; name: string }
    expect(row).toEqual({ version: 1, name: 'base' })
  })
})

describe('migrate - a migration that declines', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function recordedVersions(db: Database): number[] {
    return (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[])
      .map((row) => row.version)
  }

  it('is not recorded as applied, so it runs again next time', () => {
    const db = new Database(':memory:')
    const up = vi.fn(() => {
      throw new MigrationDeclinedError('resolve the duplicate rows first')
    })

    // Recording a decline as applied is how a constraint silently never gets
    // created: the database says the migration is done, and nothing retries it.
    migrate(db, [makeMigration(28, 'needs-data', up)])

    expect(recordedVersions(db)).toEqual([])
  })

  it('retries on the next run instead of being consumed', () => {
    const db = new Database(':memory:')
    const attempts: number[] = []
    const flaky = makeMigration(28, 'needs-data', () => {
      attempts.push(Date.now())
      if (attempts.length === 1) throw new MigrationDeclinedError('not yet')
    })

    migrate(db, [flaky])

    expect(attempts).toHaveLength(1)
    expect(recordedVersions(db)).toEqual([])

    migrate(db, [flaky])

    expect(attempts).toHaveLength(2)
    expect(recordedVersions(db)).toEqual([28])
  })

  it('does not take the server down, because the data problem is the operator\'s to fix', () => {
    const db = new Database(':memory:')
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})

    expect(() => migrate(db, [makeMigration(28, 'needs-data', () => {
      throw new MigrationDeclinedError('duplicate rows')
    })])).not.toThrow()

    // An ordinary failure still propagates, so a broken migration cannot leave
    // the server running on a schema it does not understand.
    expect(() => migrate(db, [makeMigration(29, 'broken', () => {
      throw new Error('syntax error near "CREAT"')
    })])).toThrow('syntax error')

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('declined'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not recorded as applied'))
  })

  it('stops at the decline instead of stacking later migrations on a missing one', () => {
    const db = new Database(':memory:')
    const later = vi.fn()

    migrate(db, [
      makeMigration(28, 'needs-data', () => { throw new MigrationDeclinedError('duplicate rows') }),
      makeMigration(29, 'depends-on-28', later),
    ])

    // 29 assumes 28 happened. Running it anyway would build on a schema that
    // is missing the change the whole point of 28 was.
    expect(later).not.toHaveBeenCalled()
    expect(recordedVersions(db)).toEqual([])
  })

  it('still applies what came before the decline', () => {
    const db = new Database(':memory:')
    const before = vi.fn()

    migrate(db, [
      makeMigration(27, 'fine', before),
      makeMigration(28, 'needs-data', () => { throw new MigrationDeclinedError('duplicate rows') }),
    ])

    expect(before).toHaveBeenCalledTimes(1)
    expect(recordedVersions(db)).toEqual([27])
  })
})
