import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import migration028 from '../../src/db/migrations/028-repos-uniqueness-per-user'
import {
  anyOwner,
  createRepo,
  getRepoById,
  getRepoByLocalPath,
  getRepoBySourcePath,
  getRepoByUrlAndBranch,
  ownedBy,
} from '../../src/db/queries'
import { runWithAccessScope } from '../../src/auth/access-scope'
import type { GitAuthService } from '../../src/services/git-auth'

/**
 * `repos.local_path` is a name inside a per-user directory, so uniqueness on it
 * has to be per user too.
 *
 * The checkout has always been per user - `resolveRepoBase` hands back
 * `getUserReposPath(username)`, so two people cloning the same repository get
 * two directories that share nothing on disk. The column, however, holds only
 * the bare name, and migration 4 indexed it globally. The second user to clone
 * anything the first user already had hit a constraint violation on a collision
 * that could not physically happen, and the recovery path then went looking by
 * URL - which missed, because the branch differed - so the failure surfaced as
 * "already exists but could not be retrieved. This may indicate database
 * corruption."
 *
 * These tests use a real in-memory database with every migration applied. A
 * mocked one cannot express the part that actually broke: which index fires.
 */

let db: Database
let workspaceRoot: string
let gitAuth: GitAuthService

function git(args: string[], cwd?: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
  }).trim()
}

function createGitAuthService(env: Record<string, string> = {}): GitAuthService {
  return {
    getGitEnvironment: () => env,
    getSSHEnvironment: () => ({}),
    setupSSHForRepoUrl: async () => false,
    cleanupSSHKey: async () => {},
  } as unknown as GitAuthService
}

function createOrigin(originPath: string, workPath: string): void {
  mkdirSync(originPath, { recursive: true })
  git(['init', '--bare', originPath])
  mkdirSync(workPath, { recursive: true })
  git(['init', '-b', 'main'], workPath)
  git(['config', 'user.email', 'test@test.com'], workPath)
  git(['config', 'user.name', 'Test'], workPath)
  git(['commit', '--allow-empty', '-m', 'init'], workPath)
  git(['remote', 'add', 'origin', originPath], workPath)
  git(['push', 'origin', 'main'], workPath)
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], originPath)
}

function newOrigin(label: string): string {
  const origin = path.join(workspaceRoot, `${label}.git`)
  createOrigin(origin, path.join(workspaceRoot, `${label}-work`))
  return origin
}

/** The per-user base `cloneRepo` is supposed to resolve, and a real one on disk. */
function scopeFor(username: string) {
  const userRoot = path.join(workspaceRoot, 'users', username)
  const repoBase = path.join(userRoot, 'workspace', 'repos')
  mkdirSync(repoBase, { recursive: true })
  return { roots: [userRoot], browseRoot: userRoot, repoBase, username }
}

function cloneAs(username: string, url: string, options: { directoryName?: string; branch?: string } = {}) {
  return import('../../src/services/repo').then(({ cloneRepo }) =>
    runWithAccessScope(scopeFor(username), () =>
      cloneRepo(db, gitAuth, url, { ...options, userId: username }),
    ),
  )
}

/**
 * Insert past `createRepo` on purpose.
 *
 * `createRepo` deduplicates first, so asking it to create a second row with a
 * name it already owns returns the first one instead of violating anything. The
 * index is what is under test here, and only raw SQL can reach it.
 */
function insertRaw(
  localPath: string,
  userId: string | null,
  repoUrl: string | null = null,
  sourcePath: string | null = null,
): void {
  db.prepare(`
    INSERT INTO repos (repo_url, local_path, source_path, default_branch, clone_status, cloned_at, last_accessed_at, user_id)
    VALUES (?, ?, ?, 'main', 'ready', ?, ?, ?)
  `).run(repoUrl, localPath, sourcePath, Date.now(), Date.now(), userId)
}

beforeEach(() => {
  db = new Database(':memory:')
  migrate(db, allMigrations)
  workspaceRoot = mkdtempSync(path.join(tmpdir(), 'ocm-per-user-'))
  gitAuth = createGitAuthService({})
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
  db.close()
})

describe('two users cloning the same repository', () => {
  it('gives each user their own row instead of failing the second one', async () => {
    const origin = newOrigin('relayab')

    const alice = await cloneAs('alice', origin, { directoryName: 'RelayAB' })
    const bob = await cloneAs('bob', origin, { directoryName: 'RelayAB' })

    expect(bob.cloneStatus).toBe('ready')
    expect(bob.id).not.toBe(alice.id)
    expect(bob.userId).toBe('bob')
    expect(alice.userId).toBe('alice')
  })

  it('stores the same directory name twice, once per user, in different directories', async () => {
    const origin = newOrigin('relayab')

    const alice = await cloneAs('alice', origin, { directoryName: 'RelayAB' })
    const bob = await cloneAs('bob', origin, { directoryName: 'RelayAB' })

    // The name is the same and that is the whole point - the directories it
    // resolves against are not.
    expect(alice.localPath).toBe('RelayAB')
    expect(bob.localPath).toBe('RelayAB')
    expect(alice.sourcePath).not.toBe(bob.sourcePath)
    expect(existsSync(path.join(alice.sourcePath!, '.git'))).toBe(true)
    expect(existsSync(path.join(bob.sourcePath!, '.git'))).toBe(true)
  })

  it('keeps each user pointing at their own row', async () => {
    const origin = newOrigin('relayab')

    const alice = await cloneAs('alice', origin, { directoryName: 'RelayAB' })
    await cloneAs('bob', origin, { directoryName: 'RelayAB' })

    expect(getRepoByLocalPath(db, 'RelayAB', ownedBy('alice'))?.userId).toBe('alice')
    expect(getRepoByLocalPath(db, 'RelayAB', ownedBy('bob'))?.userId).toBe('bob')
    // No branch was asked for, so the column is null and the lookup has to ask
    // for null too. Looking for 'main' here would miss and quietly pass for a
    // scoping bug.
    expect(getRepoByUrlAndBranch(db, alice.repoUrl!, undefined, ownedBy('alice'))?.userId).toBe('alice')
    expect(getRepoByUrlAndBranch(db, alice.repoUrl!, undefined, ownedBy('bob'))?.userId).toBe('bob')
  })

  it('lets a second user on a different branch of the same repository', async () => {
    const origin = newOrigin('relayab')
    // The original report named `branch 'default'`, which is only how a null
    // branch is displayed. Give the two users different real branches so this
    // cannot pass for a branch-mismatch coincidence.
    git(['branch', 'feature'], path.join(workspaceRoot, 'relayab-work'))

    const alice = await cloneAs('alice', origin, { directoryName: 'RelayAB', branch: 'main' })
    const bob = await cloneAs('bob', origin, { directoryName: 'RelayAB', branch: 'feature' })

    expect(alice.branch).toBe('main')
    expect(bob.branch).toBe('feature')
    expect(getRepoByUrlAndBranch(db, origin, 'main', ownedBy('alice'))?.id).toBe(alice.id)
    expect(getRepoByUrlAndBranch(db, origin, 'main', ownedBy('bob'))).toBeNull()
  })

  it('lets a second user take the same branch, which the global url index used to refuse', async () => {
    const origin = newOrigin('relayab')

    // Same repository *and* the same explicitly chosen branch. Scoping only
    // the directory name would leave this one failing - the same bug with one
    // fewer step to reproduce, and it would only reach anyone who bothers to
    // pick a branch.
    const alice = await cloneAs('alice', origin, { directoryName: 'RelayAB', branch: 'main' })
    const bob = await cloneAs('bob', origin, { directoryName: 'RelayAB', branch: 'main' })

    expect(bob.cloneStatus).toBe('ready')
    expect(bob.id).not.toBe(alice.id)
    expect(getRepoByUrlAndBranch(db, origin, 'main', ownedBy('alice'))?.id).toBe(alice.id)
    expect(getRepoByUrlAndBranch(db, origin, 'main', ownedBy('bob'))?.id).toBe(bob.id)
  })

  it('still refuses the same branch twice for one user', async () => {
    const origin = newOrigin('relayab')

    const first = await cloneAs('alice', origin, { directoryName: 'RelayAB', branch: 'main' })
    const again = await cloneAs('alice', origin, { directoryName: 'RelayAB', branch: 'main' })

    expect(again.id).toBe(first.id)
  })
})

describe('lookups stay inside the population they were asked about', () => {
  it('does not answer one user with another user’s row', () => {
    insertRaw('shared-name', 'alice')
    insertRaw('shared-name', 'bob')

    expect(getRepoByLocalPath(db, 'shared-name', ownedBy('alice'))?.userId).toBe('alice')
    expect(getRepoByLocalPath(db, 'shared-name', ownedBy('bob'))?.userId).toBe('bob')
    expect(getRepoByLocalPath(db, 'shared-name', ownedBy('carol'))).toBeNull()
  })

  it('does not answer a user with a shared row either', () => {
    insertRaw('shared-name', null)

    expect(getRepoByLocalPath(db, 'shared-name', ownedBy(null))?.userId).toBeNull()
    expect(getRepoByLocalPath(db, 'shared-name', ownedBy('alice'))).toBeNull()
  })

  it('scopes the source path lookup too', () => {
    insertRaw('mine', 'alice', 'https://github.com/example/mine.git', '/workspace/users/alice/workspace/repos/mine')
    insertRaw('theirs', 'bob', 'https://github.com/example/theirs.git', '/workspace/users/bob/workspace/repos/theirs')

    expect(getRepoBySourcePath(db, '/workspace/users/alice/workspace/repos/mine', ownedBy('bob'))).toBeNull()
    expect(getRepoBySourcePath(db, '/workspace/users/alice/workspace/repos/mine', ownedBy('alice'))?.userId).toBe('alice')
  })

  it('treats an undefined owner the same as a shared row', () => {
    insertRaw('legacy', null)

    expect(getRepoByLocalPath(db, 'legacy', ownedBy(undefined))?.userId).toBeNull()
  })

  it('matches either owner when explicitly asked for any', () => {
    insertRaw('a-name', 'alice')
    insertRaw('b-name', 'bob')
    insertRaw('c-name', null)

    // Ordered by id, so an unscoped match is reproducible rather than whatever
    // the planner happened to reach first.
    expect(getRepoByLocalPath(db, 'b-name', anyOwner())?.userId).toBe('bob')
    expect(getRepoByLocalPath(db, 'c-name', anyOwner())?.userId).toBeNull()
  })
})

describe('one user cannot have two repositories under one name', () => {
  it('still rejects the second one and says which name is taken', async () => {
    const first = newOrigin('first')
    const second = newOrigin('second')

    await cloneAs('alice', first, { directoryName: 'taken' })

    // Same user, two different repositories, one directory name. This is the
    // collision that is real, and it has to keep failing.
    await expect(cloneAs('alice', second, { directoryName: 'taken' })).rejects.toThrow(/directory name 'taken' is already used/)
  })

  it('does not describe a name collision as database corruption', async () => {
    const first = newOrigin('first')
    const second = newOrigin('second')

    await cloneAs('alice', first, { directoryName: 'taken' })

    const error = await cloneAs('alice', second, { directoryName: 'taken' }).then(
      () => null,
      (thrown: unknown) => thrown,
    )

    expect(error).not.toBeNull()
    expect(String(error)).toMatch(/directory name 'taken' is already used/)
    expect(String(error)).not.toMatch(/corruption/)
    expect(String(error)).not.toMatch(/could not be retrieved/)
  })
})

describe('the index reports every column, so the message cannot read off the first', () => {
  it('lists the owner before the name', () => {
    insertRaw('collide', 'alice')

    // This is why the message looks for `local_path` among the columns rather
    // than taking the first one: the first is the user's own identity, which is
    // the one thing they cannot choose differently, and telling someone to
    // change it would be a worse message than the one it replaced.
    expect(() => insertRaw('collide', 'alice')).toThrow(/repos\.user_id, repos\.local_path/)
  })

  it('blames the directory and not the owner when one user claims a used name', async () => {
    // Reachable, and the reason it is worth a message at all: `createRepo`
    // dedupes by URL, while the index constrains the directory name. Two
    // different URLs wanting one name therefore pass the lookup and fail the
    // insert, which is exactly what the old message hid behind "this may
    // indicate database corruption".
    const first = newOrigin('first')
    const second = newOrigin('second')

    await cloneAs('alice', first, { directoryName: 'mine' })
    const error = await cloneAs('alice', second, { directoryName: 'mine' }).then(
      () => null,
      (thrown: unknown) => thrown,
    )

    expect(error).not.toBeNull()
    expect(String(error)).toMatch(/directory name 'mine'/)
    expect(String(error)).not.toMatch(/user_id/)
  })
})

describe('the previous deduplication still works', () => {
  it('returns the same row when one user repeats their own clone', async () => {
    const origin = newOrigin('repeat')

    const first = await cloneAs('alice', origin, { directoryName: 'repeat-me' })
    const second = await cloneAs('alice', origin, { directoryName: 'other-name' })

    expect(second.id).toBe(first.id)
    expect(second.localPath).toBe('repeat-me')
  })

  it('returns the same row for a repeated shared clone', () => {
    const input = {
      isLocal: true as const,
      localPath: 'shared',
      defaultBranch: 'main',
      cloneStatus: 'ready' as const,
      clonedAt: Date.now(),
    }

    expect(createRepo(db, input).id).toBe(createRepo(db, input).id)
    expect(getRepoByLocalPath(db, 'shared', ownedBy(null))?.userId).toBeNull()
  })

  it('does not let a user’s own row satisfy a shared lookup', () => {
    insertRaw('mixed', 'alice')

    expect(getRepoByLocalPath(db, 'mixed', ownedBy(null))).toBeNull()
  })
})

describe('the indexes themselves', () => {
  it('allows two owned rows to share a name', () => {
    expect(() => {
      insertRaw('same', 'alice')
      insertRaw('same', 'bob')
    }).not.toThrow()

    expect(getRepoByLocalPath(db, 'same', ownedBy('alice'))?.userId).toBe('alice')
    expect(getRepoByLocalPath(db, 'same', ownedBy('bob'))?.userId).toBe('bob')
  })

  it('keeps shared rows globally unique', () => {
    // Shared rows live in the global repos directory, so for them the old rule
    // was right all along.
    insertRaw('global', null)

    expect(() => insertRaw('global', null)).toThrow(/UNIQUE constraint failed/)
  })

  it('keeps the url and branch unique among shared rows', () => {
    db.prepare(`
      INSERT INTO repos (repo_url, local_path, branch, default_branch, clone_status, cloned_at, last_accessed_at, user_id)
      VALUES ('https://github.com/example/shared.git', 'shared', 'main', 'main', 'ready', 1, 1, NULL)
    `).run()

    expect(() => {
      db.prepare(`
        INSERT INTO repos (repo_url, local_path, branch, default_branch, clone_status, cloned_at, last_accessed_at, user_id)
        VALUES ('https://github.com/example/shared.git', 'shared-copy', 'main', 'main', 'ready', 1, 1, NULL)
      `).run()
    }).toThrow(/UNIQUE constraint failed/)
  })

  it('lets two owned rows share a url and branch', () => {
    const url = 'https://github.com/example/both.git'
    const insert = db.prepare(`
      INSERT INTO repos (repo_url, local_path, branch, default_branch, clone_status, cloned_at, last_accessed_at, user_id)
      VALUES (?, ?, 'main', 'main', 'ready', 1, 1, ?)
    `)
    // Three users, not two: both keys are per user now, so the third one is
    // allowed as well. What has to stay refused is the *same* user holding the
    // same repository at the same branch twice.
    insert.run(url, 'both', 'alice')
    insert.run(url, 'both', 'bob')
    insert.run(url, 'both', 'carol')

    expect(() => insert.run(url, 'both', 'alice')).toThrow(/UNIQUE constraint failed/)
  })

  it('replaces the global indexes rather than adding to them', () => {
    const indexes = db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'repos'")
      .all() as { name: string; sql: string | null }[]

    const localPath = indexes.filter((index) => index.name.startsWith('idx_local_path'))
    expect(localPath.map((index) => index.name).sort()).toEqual(['idx_local_path', 'idx_local_path_shared'])
    expect(localPath.find((index) => index.name === 'idx_local_path')?.sql).toMatch(/user_id/)

    const urlBranch = indexes.filter((index) => index.name.startsWith('idx_repo_url_branch'))
    expect(urlBranch.map((index) => index.name).sort()).toEqual(['idx_repo_url_branch', 'idx_repo_url_branch_shared'])
    expect(urlBranch.find((index) => index.name === 'idx_repo_url_branch')?.sql).toMatch(/user_id/)
  })
})

describe('migration 028 reverses only when it can', () => {
  it('restores the global index while names are still unique', () => {
    insertRaw('unique', 'alice')
    insertRaw('different', 'bob')

    expect(() => migration028.down(db)).not.toThrow()

    expect(() => insertRaw('unique', 'bob')).toThrow(/UNIQUE constraint failed/)
  })

  it('refuses to reverse once two users share a name, and says which', () => {
    // The rows are exactly what the migration was for, so there is no way back
    // to a single global namespace without renaming them. Saying so beats
    // dropping a constraint and leaving the data in a state the old index
    // could not have held.
    insertRaw('both', 'alice')
    insertRaw('both', 'bob')

    expect(() => migration028.down(db)).toThrow(/local_path 'both' \(2 owners\)/)
  })

  it('refuses to reverse once two users share a url and branch', () => {
    const url = 'https://github.com/example/shared-branch.git'
    const insert = db.prepare(`
      INSERT INTO repos (repo_url, local_path, branch, default_branch, clone_status, cloned_at, last_accessed_at, user_id)
      VALUES (?, ?, 'main', 'main', 'ready', 1, 1, ?)
    `)
    insert.run(url, 'one', 'alice')
    insert.run(url, 'two', 'bob')

    expect(() => migration028.down(db)).toThrow(/shared-branch\.git'#main \(2 owners\)/)
  })
})

describe('existing rows survive the migration', () => {
  it('reads back a row created before the index changed', () => {
    const repo = createRepo(db, {
      repoUrl: 'https://github.com/CloudyAasim/RelayAB',
      localPath: 'RelayAB',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      userId: 'alice',
    })

    expect(getRepoById(db, repo.id)?.localPath).toBe('RelayAB')
    expect(getRepoByLocalPath(db, 'RelayAB', ownedBy('alice'))?.id).toBe(repo.id)
  })
})

/**
 * The local-path routes take a directory the caller names, and until the guard
 * below any signed-in user could hand over somebody else's checkout.
 *
 * What makes that more than a read: the row is written with the *caller's* id,
 * so every ownership filter downstream treats it as theirs. Its `source_path`
 * then joins `accessibleRepoOwnerPaths`, which is the list `GET /api/files` and
 * the OpenCode proxy resolve against - and the same value reaches the delete
 * path. Registering was enough to own it.
 *
 * The guard is scoped to the request rather than absolute, because registering
 * a path the user named is only a request-time operation. The startup relink
 * runs without a scope and keeps working; `access-scope.ts` documents that
 * trade explicitly.
 */
describe('registering a local path stays inside the caller', () => {
  let previousWorkspacePath: string | undefined

  beforeEach(() => {
    // `ENV.WORKSPACE.BASE_PATH` is a getter, so this takes effect immediately
    // and makes the temp tree the real workspace for the rest of the block -
    // which keeps the alias path inside the scope's own repo directory instead
    // of the machine's default one.
    previousWorkspacePath = process.env.WORKSPACE_PATH
    process.env.WORKSPACE_PATH = workspaceRoot
  })

  afterEach(() => {
    if (previousWorkspacePath === undefined) {
      delete process.env.WORKSPACE_PATH
    } else {
      process.env.WORKSPACE_PATH = previousWorkspacePath
    }
  })

  function committedRepoAt(target: string): string {
    mkdirSync(target, { recursive: true })
    git(['init', '-b', 'main'], target)
    git(['config', 'user.email', 'test@test.com'], target)
    git(['config', 'user.name', 'Test'], target)
    git(['commit', '--allow-empty', '-m', 'init'], target)
    return target
  }

  /**
   * `assertWithinAccessScope` throws a plain `{ message, statusCode }` rather
   * than an `Error`, so `rejects.toThrow` cannot see it. Captured and matched
   * structurally instead, which also pins the status the route will report.
   */
  function captureRejection(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(() => null, (error: unknown) => error)
  }

  const OUTSIDE = {
    statusCode: 403,
    message: expect.stringMatching(/outside the allowed workspace/),
  }

  it('refuses a directory that belongs to somebody else', async () => {
    const { registerExistingLocalRepo } = await import('../../src/services/repo/discovery')
    const bobDir = committedRepoAt(path.join(scopeFor('bob').repoBase, 'RelayAB'))

    const thrown = await runWithAccessScope(scopeFor('alice'), () =>
      captureRejection(registerExistingLocalRepo(db, gitAuth, bobDir, undefined, undefined, 'alice')),
    )

    expect(thrown).toMatchObject(OUTSIDE)
    // The guard has to stop the row, not just the request: a row here is what
    // puts Bob's directory into Alice's readable set.
    expect(getRepoBySourcePath(db, bobDir, anyOwner())).toBeNull()
  })

  it('refuses a path that only looks like it is inside', async () => {
    const { registerExistingLocalRepo } = await import('../../src/services/repo/discovery')
    const bobDir = committedRepoAt(path.join(scopeFor('bob').repoBase, 'RelayAB'))
    // Built as a string, not with `path.join`, on purpose: `path.join` would
    // collapse the `..` before the call and the guard would never see a
    // traversing path at all. What is under test is that
    // `normalizeAbsolutePath` resolves first and the guard measures the result
    // - a guard on the raw string would pass this.
    const aliceBase = scopeFor('alice').repoBase
    const sneaky = `${aliceBase}/../../../bob/workspace/repos/RelayAB`

    expect(path.resolve(sneaky)).toBe(bobDir)

    const thrown = await runWithAccessScope(scopeFor('alice'), () =>
      captureRejection(registerExistingLocalRepo(db, gitAuth, sneaky, undefined, undefined, 'alice')),
    )

    expect(thrown).toMatchObject(OUTSIDE)
    expect(getRepoBySourcePath(db, bobDir, anyOwner())).toBeNull()
  })

  it('still registers a directory inside the caller own workspace', async () => {
    // The positive half. Without it, "always throw" would satisfy every test
    // above and the feature would be off entirely.
    const { registerExistingLocalRepo } = await import('../../src/services/repo/discovery')
    const ownDir = committedRepoAt(path.join(scopeFor('alice').repoBase, 'Mine'))

    const { repo } = await runWithAccessScope(scopeFor('alice'), () =>
      registerExistingLocalRepo(db, gitAuth, ownDir, undefined, undefined, 'alice'),
    )

    expect(repo.userId).toBe('alice')
    expect(repo.sourcePath).toBe(ownDir)
    expect(getRepoBySourcePath(db, ownDir, ownedBy('alice'))?.id).toBe(repo.id)
  })

  it('refuses to discover under a root outside the caller own workspace', async () => {
    const { discoverLocalRepos } = await import('../../src/services/repo')
    const bobRoot = scopeFor('bob').repoBase
    const bobDir = committedRepoAt(path.join(bobRoot, 'RelayAB'))

    const thrown = await runWithAccessScope(scopeFor('alice'), () =>
      captureRejection(discoverLocalRepos(db, gitAuth, bobRoot, 2, 'alice')),
    )

    expect(thrown).toMatchObject(OUTSIDE)
    expect(getRepoBySourcePath(db, bobDir, anyOwner())).toBeNull()
  })

  it('still discovers under a root inside the caller own workspace', async () => {
    const { discoverLocalRepos } = await import('../../src/services/repo')
    const ownRoot = scopeFor('alice').repoBase
    committedRepoAt(path.join(ownRoot, 'Mine'))
    committedRepoAt(path.join(ownRoot, 'nested', 'Deeper'))

    const result = await runWithAccessScope(scopeFor('alice'), () =>
      discoverLocalRepos(db, gitAuth, ownRoot, 3, 'alice'),
    )

    expect(result.errors).toEqual([])
    expect(result.discoveredCount).toBe(2)
    expect(result.repos.every((repo) => repo.userId === 'alice')).toBe(true)
  })
})
