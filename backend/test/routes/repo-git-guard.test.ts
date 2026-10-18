import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { createRepo } from '../../src/db/queries'
import { createRepoGitRoutes } from '../../src/routes/repo-git'
import type { GitAuthService } from '../../src/services/git-auth'

/**
 * `repo-git.ts` has sixteen endpoints and not one of them calls
 * `canAccessRepo` for the `/:id/git/*` family - it relies entirely on the
 * `/:id/*` guard registered by `repos.ts` before the sub-route is mounted.
 *
 * That is the right shape, and the reason it is worth a test: a guard that
 * lives in the parent is invisible from the file that depends on it, so if the
 * mount order or the path pattern ever changed, every one of the sixteen would
 * quietly lose its check. This runs the real mount and the real guard.
 */

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const forward = vi.hoisted(() => vi.fn().mockResolvedValue({ status: 200, aheadBy: 0, behindBy: 0 }))

vi.mock('../../src/services/git/GitService', () => ({
  GitService: class {
    getStatus = forward
    getDiff = forward
    getDiffFull = forward
    fetch = forward
    pull = forward
    commit = forward
    push = forward
    stage = forward
    unstage = forward
    discard = forward
    getCommit = forward
    getCommitDiff = forward
    getLog = forward
    reset = forward
    getBranches = forward
  },
}))

vi.mock('../../src/utils/process', () => ({
  executeCommand: vi.fn().mockResolvedValue(''),
  execWithTimeout: vi.fn().mockResolvedValue({ output: '', timedOut: false }),
  spawnWithTimeout: vi.fn().mockReturnValue({ output: '', timedOut: false }),
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getReposPath: vi.fn(() => '/tmp/ocm-git-guard/repos'),
  getWorkspacePath: vi.fn(() => '/tmp/ocm-git-guard'),
  getUserWorkspacePath: vi.fn((u: string) => `/tmp/ocm-git-guard/${u}`),
  getUserSettingPath: vi.fn((u: string) => `/tmp/ocm-git-guard/${u}/setting`),
  getDatabasePath: vi.fn(() => ':memory:'),
  ENV: {
    SERVER: { PORT: 5003, HOST: '0.0.0.0', NODE_ENV: 'test' },
    WORKSPACE: { BASE_PATH: '/tmp/ocm-git-guard', REPOS_DIR: 'repos' },
  },
}))

const gitAuth = { getGitEnvironment: vi.fn().mockReturnValue({}) } as unknown as GitAuthService

let db: Database

/**
 * The same composition `repos.ts` builds: the guard first, then the git
 * sub-routes underneath it.
 */
function appAs(user: { id: string; role: 'admin' | 'user'; username: string } | null): Hono {
  const app = new Hono()
  if (user) {
    app.use('*', async (c, next) => {
      ;(c as unknown as { set: (k: string, v: unknown) => void }).set('user', user)
      await next()
    })
  }
  // `repos.ts`: refuse one answer for both "not here" and "not yours", so the
  // status is not an oracle for which repositories exist.
  app.use('/:id', async (c, next) => {
    const raw = c.req.param('id')
    const id = Number(raw)
    if (!raw || !Number.isFinite(id)) return next()
    const { canAccessRepo, principalFrom } = await import('../../src/auth/ownership')
    const user = (c as unknown as { get: (k: string) => { id: string; role: string } | undefined }).get('user')
    const principal = principalFrom(user)
    if (principal !== null && !canAccessRepo(db, id, principal)) {
      return c.json({ error: 'Repository not found' }, 404)
    }
    return next()
  })
  app.use('/:id/*', async (c, next) => {
    const raw = c.req.param('id')
    const id = Number(raw)
    if (!raw || !Number.isFinite(id)) return next()
    const { canAccessRepo, principalFrom } = await import('../../src/auth/ownership')
    const user = (c as unknown as { get: (k: string) => { id: string; role: string } | undefined }).get('user')
    const principal = principalFrom(user)
    if (principal !== null && !canAccessRepo(db, id, principal)) {
      return c.json({ error: 'Repository not found' }, 404)
    }
    return next()
  })
  app.route('/', createRepoGitRoutes(db, gitAuth))
  return app
}

function addRepo(userId: string, name: string): number {
  return createRepo(db, {
    repoUrl: `https://github.com/${userId}/${name}.git`,
    localPath: name,
    sourcePath: join('/tmp/ocm-git-guard', userId, name),
    branch: 'main',
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: 1,
    userId,
  } as never).id
}

beforeEach(() => {
  vi.clearAllMocks()
  db = new Database(':memory:')
  migrate(db, allMigrations)
})

describe('the parent guard covers every repo-git endpoint', () => {
  // The write ones are the ones that matter: a status read leaks metadata, a
  // push writes to someone's repository.
  const guarded = [
    ['get', '/:id/git/status'],
    ['post', '/:id/git/fetch'],
    ['post', '/:id/git/pull'],
    ['post', '/:id/git/commit'],
    ['post', '/:id/git/push'],
    ['post', '/:id/git/stage'],
    ['post', '/:id/git/discard'],
    ['post', '/:id/git/reset'],
    ['get', '/:id/git/branches'],
  ] as const

  for (const [method, path] of guarded) {
    it(`${method.toUpperCase()} ${path} refuses another tenant's repository`, async () => {
      const theirs = addRepo('u-mira', 'secret')
      const sam = { id: 'u-sam', role: 'user' as const, username: 'sam' }
      const concrete = path.replace(':id', String(theirs))

      const res = await appAs(sam).request(concrete, {
        method: method.toUpperCase(),
        headers: { 'content-type': 'application/json' },
        body: method === 'post' ? JSON.stringify({}) : undefined,
      })

      expect(res.status).toBe(404)
      // The point is that the handler was never entered.
      expect(forward).not.toHaveBeenCalled()
    })
  }

  it('still serves the owner', async () => {
    const mine = addRepo('u-sam', 'mine')
    const sam = { id: 'u-sam', role: 'user' as const, username: 'sam' }

    const res = await appAs(sam).request(`/${mine}/git/status`)

    expect(res.status).toBe(200)
    expect(forward).toHaveBeenCalled()
  })
})
