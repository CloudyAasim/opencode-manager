import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import {
  applyUsernameToNewUser,
  assignUsername,
  sanitizeUsername,
  uniqueUsername,
  usernameFromEmail,
} from '../../src/auth/username'
import migration032 from '../../src/db/migrations/032-backfill-null-usernames'

/**
 * A username is the key for every per-user directory on disk. It was only ever
 * assigned by the one-off backfill in migration 023, and the auth field is
 * declared `input: false`, so every account created since got `NULL` - which
 * sent `getAssistantModeDirectory` to a server-global directory shared by every
 * such user, and made `/api/providers` answer 401.
 *
 * better-auth's sign-up itself cannot run under this vitest setup: its Kysely
 * adapter calls `db.transaction` on a dialect config the `bun:sqlite` shim
 * does not satisfy. The bug was reproduced under real Bun; what is pinned here
 * is the code that assigns the name and the migration that repairs the rows
 * that already exist.
 */
describe('username derivation', () => {
  it('sanitises to a usable identifier', () => {
    expect(sanitizeUsername('  Alice  ')).toBe('alice')
    expect(sanitizeUsername('a.b-c_d')).toBe('abcd')
    expect(sanitizeUsername('1alice')).toBe('u1alice')
    expect(sanitizeUsername('ab').length).toBeGreaterThanOrEqual(3)
  })

  it('derives from the email local part', () => {
    expect(usernameFromEmail('Alice.Smith@example.com')).toBe('alicesmith')
  })

  it('avoids names that would collide with a real directory', () => {
    // `repos` is a real directory under the workspace, so a user named after it
    // would be written into the wrong place.
    expect(uniqueUsername('repos', new Set())).toBe('repos2')
    expect(uniqueUsername('admin', new Set())).toBe('admin2')
  })

  it('suffixes a name that is already taken', () => {
    expect(uniqueUsername('alice', new Set(['alice']))).toBe('alice2')
    expect(uniqueUsername('alice', new Set(['alice', 'alice2']))).toBe('alice3')
  })

  it('records the name it hands out as taken', () => {
    const taken = new Set<string>()
    expect(assignUsername('alice@example.com', taken)).toBe('alice')
    expect(assignUsername('alice@example.org', taken)).toBe('alice2')
    expect(taken.has('alice2')).toBe(true)
  })
})

describe('applyUsernameToNewUser', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
  })

  afterEach(() => {
    db.close()
  })

  function seed(email: string, username: string | null): void {
    db.prepare('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role, username) VALUES (?, ?, ?, 1, 0, 0, ?, ?)')
      .run(`id-${email}`, email.split('@')[0]!, email, 'user', username)
  }

  it('gives the pending account a username', () => {
    const user: { email: string; username?: string } = { email: 'newcomer@example.com' }

    applyUsernameToNewUser(db as never, user)

    expect(user.username).toBe('newcomer')
  })

  it('does not reuse a name already in the table', () => {
    seed('taken@example.com', 'newcomer')

    const user: { email: string; username?: string } = { email: 'other@example.com' }
    applyUsernameToNewUser(db as never, user)

    expect(user.username).toBe('other')
    const later: { email: string; username?: string } = { email: 'another@example.com' }
    applyUsernameToNewUser(db as never, later)
    expect(later.username).toBe('another')
  })

  it('still assigns one when the table holds null usernames', () => {
    // SQLite's UNIQUE index treats NULLs as distinct, so a table of them is
    // possible and the scan must not trip over them.
    seed('legacy@example.com', null)

    const user: { email: string; username?: string } = { email: 'fresh@example.com' }
    applyUsernameToNewUser(db as never, user)

    expect(user.username).toBe('fresh')
  })
})

describe('migration 032 backfills null usernames', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations.filter((m) => m.version < 32))
  })

  afterEach(() => {
    db.close()
  })

  function seedLegacy(email: string, username: string | null): void {
    db.prepare('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role, username) VALUES (?, ?, ?, 1, 0, 0, ?, ?)')
      .run(`id-${email}`, email.split('@')[0]!, email, 'user', username)
  }

  it('fills every null username and leaves existing ones alone', () => {
    seedLegacy('legacy@example.com', null)
    seedLegacy('reserved@example.com', null)
    seedLegacy('already@example.com', 'chosen')

    migration032.up(db as never)

    const rows = db.prepare('SELECT email, username FROM "user" ORDER BY email').all() as { email: string; username: string }[]
    const byEmail = Object.fromEntries(rows.map((r) => [r.email, r.username]))

    expect(byEmail['legacy@example.com']).toBe('legacy')
    expect(byEmail['reserved@example.com']).toBe('reserved')
    expect(byEmail['already@example.com']).toBe('chosen')

    const nulls = db.prepare(`SELECT COUNT(*) AS c FROM "user" WHERE username IS NULL OR TRIM(username) = ''`).get() as { c: number }
    expect(nulls.c).toBe(0)
  })

  it('leaves no duplicate usernames behind', () => {
    seedLegacy('a@example.com', null)
    seedLegacy('b@example.com', null)
    seedLegacy('a@other.com', null)

    migration032.up(db as never)

    const dupes = db.prepare('SELECT username, COUNT(*) AS c FROM "user" GROUP BY username HAVING c > 1').all()
    expect(dupes).toEqual([])
  })
})
