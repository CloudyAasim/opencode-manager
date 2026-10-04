import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { execSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { listRepos, getRepoByLocalPath } from '../../src/db/queries'

/**
 * A repository reaches the projects directory from more places than this app's
 * own API: the assistant runs `git clone` in a shell, a user clones by hand, a
 * directory gets moved. Before this, registration only happened as a side
 * effect of the UI calling `POST /repos` or `POST /repos/discover`, so all of
 * those produced the same thing - a real repository sitting in the projects
 * folder that never shows up as a project.
 *
 * Real filesystem, real git, real database on purpose. The whole claim is "a
 * directory in the projects folder becomes a project", and a mock database
 * would only be asserting that the mock was called.
 */

const envRef = { root: '' }

vi.mock('@opencode-manager/shared/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opencode-manager/shared/config/env')>()
  return {
    ...actual,
    getWorkspacePath: () => envRef.root,
    getUsersWorkspacePath: () => envRef.root,
    getUserWorkspacePath: (username: string) => path.join(envRef.root, username, 'workspace'),
    getUserSettingPath: (username: string) => path.join(envRef.root, username, 'setting'),
    getUserReposPath: (username: string) => path.join(envRef.root, username, 'workspace', 'repos'),
  }
})

import { reconcileUserRepos, resetReconcileThrottle } from '../../src/services/repo/reconcile'
import type { Principal } from '../../src/auth/ownership'

const env = process.env as Record<string, string>

const gitAuthService = {
  getGitEnvironment: () => env,
} as never

function makeCommittedRepo(dir: string, message = 'Initial commit'): void {
  execSync(`git init -q "${dir}"`, { env })
  execSync(`git -C "${dir}" config user.email test@test.com`, { env })
  execSync(`git -C "${dir}" config user.name Test`, { env })
  writeFileSync(path.join(dir, 'README.md'), `# ${path.basename(dir)}\n`)
  execSync(`git -C "${dir}" add -A`, { env })
  execSync(`git -C "${dir}" commit -q -m "${message}"`, { env })
}

function principalFor(username: string, id: string): Principal {
  return { id, role: 'user', username }
}

describe('reconcileUserRepos registers repositories the app never heard of', () => {
  let db: Database
  let tmpRoot: string
  let reposDir: string

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)

    tmpRoot = mkdtempSync(path.join(tmpdir(), 'ocm-reconcile-'))
    envRef.root = tmpRoot
    reposDir = path.join(tmpRoot, 'aasim', 'workspace', 'repos')
    mkdirSync(reposDir, { recursive: true })

    // The per-user rate limit lives in module state, so it has to be cleared
    // between cases or the second one asserts nothing at all.
    resetReconcileThrottle()
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
    db.close()
  })

  it('turns a repository sitting in the projects folder into a project', async () => {
    makeCommittedRepo(path.join(reposDir, 'RelayAB'))

    const result = await reconcileUserRepos(db, gitAuthService, principalFor('aasim', 'user-1'))

    expect(result.registeredCount).toBe(1)
    expect(result.errors).toEqual([])
    expect(getRepoByLocalPath(db, 'RelayAB')).not.toBeNull()
    expect(listRepos(db).map((repo) => repo.localPath)).toContain('RelayAB')
  })

  it('finds repositories nested one level deep, the way the manual scan does', async () => {
    const group = path.join(reposDir, 'org')
    mkdirSync(group, { recursive: true })
    makeCommittedRepo(path.join(group, 'nested-repo'))

    const result = await reconcileUserRepos(db, gitAuthService, principalFor('aasim', 'user-1'))

    expect(result.registeredCount).toBe(1)
    // A repository already inside the projects folder keeps its own relative
    // path as its local path - no alias, no symlink. That is the difference
    // between discovering something and pointing a new name at it.
    expect(getRepoByLocalPath(db, 'org/nested-repo')).not.toBeNull()
  })

  it('leaves a directory that is not a repository alone', async () => {
    const plain = path.join(reposDir, 'scratch')
    mkdirSync(plain, { recursive: true })
    writeFileSync(path.join(plain, 'notes.txt'), 'not a repo')

    const result = await reconcileUserRepos(db, gitAuthService, principalFor('aasim', 'user-1'))

    expect(result.registeredCount).toBe(0)
    expect(getRepoByLocalPath(db, 'scratch')).toBeNull()
  })

  it('does not register the Assistant directory as a phantom project', async () => {
    // The Assistant lives inside the global projects directory and is built on
    // demand rather than stored, so it has no row to match against. Left in,
    // it appears as a second project duplicating the Assistant.
    makeCommittedRepo(path.join(reposDir, 'assistant'))

    const result = await reconcileUserRepos(db, gitAuthService, principalFor('aasim', 'user-1'))

    expect(getRepoByLocalPath(db, 'assistant')).toBeNull()
    expect(result.registeredCount).toBe(0)
  })

  it('does not touch another user’s projects directory', async () => {
    const otherRepos = path.join(tmpRoot, 'someone-else', 'workspace', 'repos')
    mkdirSync(otherRepos, { recursive: true })
    makeCommittedRepo(path.join(otherRepos, 'not-yours'))

    await reconcileUserRepos(db, gitAuthService, principalFor('aasim', 'user-1'))

    expect(getRepoByLocalPath(db, 'not-yours')).toBeNull()
  })

  it('reports a project it already knows as existing rather than adding it twice', async () => {
    makeCommittedRepo(path.join(reposDir, 'RelayAB'))

    const first = await reconcileUserRepos(db, gitAuthService, principalFor('aasim', 'user-1'), { force: true })
    const second = await reconcileUserRepos(db, gitAuthService, principalFor('aasim', 'user-1'), { force: true })

    expect(first.registeredCount).toBe(1)
    expect(second.registeredCount).toBe(0)
    expect(second.existingCount).toBe(1)
    expect(listRepos(db).filter((repo) => repo.localPath === 'RelayAB')).toHaveLength(1)
  })

  it('skips a second scan inside the rate limit, and force overrides it', async () => {
    makeCommittedRepo(path.join(reposDir, 'first'))
    expect((await reconcileUserRepos(db, gitAuthService, principalFor('aasim', 'user-1'))).skipped).toBe(false)

    // Rate-limited: the directory is not even looked at.
    makeCommittedRepo(path.join(reposDir, 'second'))
    const throttled = await reconcileUserRepos(db, gitAuthService, principalFor('aasim', 'user-1'))
    expect(throttled.skipped).toBe(true)
    expect(getRepoByLocalPath(db, 'second')).toBeNull()

    const forced = await reconcileUserRepos(db, gitAuthService, principalFor('aasim', 'user-1'), { force: true })
    expect(forced.skipped).toBe(false)
    expect(getRepoByLocalPath(db, 'second')).not.toBeNull()
  })

  it('is a no-op when the projects directory does not exist yet', async () => {
    // A fresh account has no projects folder. That is a normal state, not an
    // error, and it must not produce a rejection the project list has to
    // swallow on every navigation.
    rmSync(path.join(tmpRoot, 'aasim'), { recursive: true, force: true })
    expect(existsSync(reposDir)).toBe(false)

    const result = await reconcileUserRepos(db, gitAuthService, principalFor('aasim', 'user-1'))

    expect(result).toEqual({ registeredCount: 0, existingCount: 0, skipped: false, errors: [] })
  })
})
