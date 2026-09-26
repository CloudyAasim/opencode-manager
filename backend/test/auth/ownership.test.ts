import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Database } from 'bun:sqlite'
import { createTestDb } from '../helpers/assistant-workspace'
import { accessibleRepoIds, canAccessOwner, canAccessRepo, principalFrom } from '../../src/auth/ownership'

function insertRepo(db: Database, id: number, userId: string | null): void {
  db.prepare(
    `INSERT INTO repos (id, repo_url, local_path, default_branch, clone_status, cloned_at, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, 'https://example.com/x/y.git', `r${id}`, 'main', 'ready', Date.now(), userId)
}

const alice = { id: 'alice', role: 'user' as const }
const bob = { id: 'bob', role: 'user' as const }
const admin = { id: 'root', role: 'admin' as const }

describe('ownership helpers', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    db = createTestDb()
    insertRepo(db, 0, null) // assistant/system repo
    insertRepo(db, 1, 'alice')
    insertRepo(db, 2, 'bob')
    insertRepo(db, 3, null) // shared
  })

  afterEach(() => {
    db.close()
  })

  it('derives a principal from a session user', () => {
    expect(principalFrom({ id: 'alice', role: 'admin' } as never)).toEqual({ id: 'alice', role: 'admin', username: null })
    expect(principalFrom({ id: 'alice' } as never)).toEqual({ id: 'alice', role: 'user', username: null })
    expect(principalFrom({ id: 'alice', username: 'alice' } as never)).toEqual({ id: 'alice', role: 'user', username: 'alice' })
    expect(principalFrom(undefined)).toBeNull()
  })

  it('treats system/shared data as accessible to everyone', () => {
    expect(canAccessOwner(null, alice)).toBe(true)
    expect(canAccessOwner(undefined, bob)).toBe(true)
    expect(canAccessOwner('alice', bob)).toBe(false)
  })

  it('lets administrators access every repo', () => {
    expect(canAccessRepo(db, 1, admin)).toBe(true)
    expect(canAccessRepo(db, 2, admin)).toBe(true)
    expect(canAccessRepo(db, 999, admin)).toBe(false)
  })

  it('scopes normal users to their own and shared repos', () => {
    expect(canAccessRepo(db, 1, alice)).toBe(true)
    expect(canAccessRepo(db, 2, alice)).toBe(false)
    expect(canAccessRepo(db, 3, alice)).toBe(true)
    expect(canAccessRepo(db, 0, alice)).toBe(true)
  })

  it('lists accessible repo ids', () => {
    expect(accessibleRepoIds(db, alice).sort()).toEqual([0, 1, 3])
    expect(accessibleRepoIds(db, admin).sort()).toEqual([0, 1, 2, 3])
    expect(accessibleRepoIds(db, null)).toEqual([])
  })
})
