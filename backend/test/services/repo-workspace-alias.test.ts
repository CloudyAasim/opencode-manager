import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { getRepoByLocalPath, ownedBy } from '../../src/db/queries'
import { runWithAccessScope } from '../../src/auth/access-scope'

/**
 * `pickWorkspaceAlias` is a *name allocator*: it hands out the next free
 * directory name for a user's next checkout.
 *
 * It asks two questions - is there already a row for this source, and is this
 * name free - and both answers have to come from the population the caller
 * cares about. Left unscoped, a name another user had already taken would read
 * as occupied even though it sits in a completely different directory, and the
 * allocator would hand out `my-app-2` to someone whose `my-app` was never in
 * the way.
 *
 * The filesystem half is per user too, via `reposBase()` reading the access
 * scope, so the two halves have to agree about whose names these are.
 */

let db: Database
let tmpRoot: string

function scopeFor(username: string) {
  const userRoot = path.join(tmpRoot, 'users', username)
  const repoBase = path.join(userRoot, 'workspace', 'repos')
  mkdirSync(repoBase, { recursive: true })
  return { roots: [userRoot], browseRoot: userRoot, repoBase, username }
}

function pick(username: string, sourcePath: string, rootPath?: string) {
  return import('../../src/services/repo/workspace-alias').then(({ pickWorkspaceAlias }) =>
    runWithAccessScope(scopeFor(username), () => pickWorkspaceAlias(db, sourcePath, rootPath, username)),
  )
}

function insertRepo(localPath: string, sourcePath: string, userId: string | null): void {
  db.prepare(`
    INSERT INTO repos (repo_url, local_path, source_path, default_branch, clone_status, cloned_at, last_accessed_at, user_id)
    VALUES (?, ?, ?, 'main', 'ready', ?, ?, ?)
  `).run(null, localPath, sourcePath, Date.now(), Date.now(), userId)
}

beforeEach(() => {
  db = new Database(':memory:')
  migrate(db, allMigrations)
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'ocm-alias-'))
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
  db.close()
})

describe('pickWorkspaceAlias', () => {
  it('uses the bare directory name when nothing is in the way', async () => {
    const source = path.join(tmpRoot, 'projects', 'RelayAB')
    mkdirSync(path.dirname(source), { recursive: true })

    await expect(pick('alice', source)).resolves.toBe('RelayAB')
  })

  it('returns the name already recorded for this source', async () => {
    const source = path.join(tmpRoot, 'projects', 'RelayAB')
    mkdirSync(source, { recursive: true })
    insertRepo('a-nicer-name', source, 'alice')

    await expect(pick('alice', source)).resolves.toBe('a-nicer-name')
  })

  it('does not hand another user the name they already recorded for that source', async () => {
    const source = path.join(tmpRoot, 'projects', 'RelayAB')
    mkdirSync(source, { recursive: true })
    insertRepo('a-nicer-name', source, 'alice')

    // Bob is pointing at a path that happens to be the same string. Alice's
    // row is not his, so he gets the name derived from the directory instead.
    await expect(pick('bob', source)).resolves.toBe('RelayAB')
  })

  it('does not let another user’s name block this one', async () => {
    const aliceSource = path.join(tmpRoot, 'projects', 'RelayAB')
    const bobSource = path.join(tmpRoot, 'projects', 'RelayAB')
    mkdirSync(aliceSource, { recursive: true })
    insertRepo('RelayAB', aliceSource, 'alice')

    // Same name, different directory tree, no conflict - yet the row is enough
    // to push Bob to a suffixed name if the lookup is not scoped.
    await expect(pick('bob', bobSource)).resolves.toBe('RelayAB')
  })

  it('still avoids a name this user has already taken', async () => {
    const first = path.join(tmpRoot, 'projects', 'RelayAB')
    const second = path.join(tmpRoot, 'projects', 'other', 'RelayAB')
    mkdirSync(first, { recursive: true })
    mkdirSync(second, { recursive: true })
    insertRepo('RelayAB', first, 'alice')

    await expect(pick('alice', second)).resolves.toBe('RelayAB-2')
  })

  it('does not count a name this user has not taken as taken', async () => {
    const source = path.join(tmpRoot, 'projects', 'RelayAB')
    mkdirSync(source, { recursive: true })
    insertRepo('RelayAB', path.join(tmpRoot, 'projects', 'other', 'RelayAB'), 'carol')

    await expect(pick('alice', source)).resolves.toBe('RelayAB')
  })

  it('keeps the name when only the row belongs to somebody else', async () => {
    const source = path.join(tmpRoot, 'projects', 'RelayAB')
    mkdirSync(source, { recursive: true })
    insertRepo('RelayAB', source, 'bob')

    // The row is for the same source path, but the source path belongs to
    // somebody else's row. Alice gets the natural name.
    expect(getRepoByLocalPath(db, 'RelayAB', ownedBy('alice'))).toBeNull()
    await expect(pick('alice', source)).resolves.toBe('RelayAB')
  })
})
