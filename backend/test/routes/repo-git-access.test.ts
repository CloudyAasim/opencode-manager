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
 * `POST /git-status-batch` sits at `/git-status-batch`, so it does not match
 * the `/:id/*` shape the parent `repoAccessGuard` covers, and it narrows by
 * hand instead.
 *
 * It read `principal === null` as "no narrowing" and served every id asked
 * for - the same fail-open as `session-pins` and `prompt-templates`, where a
 * null identity meant "all of them". A batch is exactly the shape that sweeps
 * ids, so that default is backwards.
 *
 * `repo-git.test.ts` mounts a stand-in owner and so never reached this; these
 * run the real `canAccessRepo` against a real database.
 */

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../src/utils/process', () => ({
  executeCommand: vi.fn().mockResolvedValue(''),
  execWithTimeout: vi.fn().mockResolvedValue({ output: '', timedOut: false }),
  spawnWithTimeout: vi.fn().mockReturnValue({ output: '', timedOut: false }),
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getReposPath: vi.fn(() => '/tmp/ocm-git-access/repos'),
  getWorkspacePath: vi.fn(() => '/tmp/ocm-git-access'),
  getUserWorkspacePath: vi.fn((u: string) => `/tmp/ocm-git-access/${u}`),
  getUserSettingPath: vi.fn((u: string) => `/tmp/ocm-git-access/${u}/setting`),
  getDatabasePath: vi.fn(() => ':memory:'),
  ENV: {
    SERVER: { PORT: 5003, HOST: '0.0.0.0', NODE_ENV: 'test' },
    WORKSPACE: { BASE_PATH: '/tmp/ocm-git-access', REPOS_DIR: 'repos' },
  },
}))

const gitAuth = { getGitEnvironment: vi.fn().mockReturnValue({}) } as unknown as GitAuthService

let db: Database

function addRepo(userId: string, name: string): number {
  return createRepo(db, {
    repoUrl: `https://github.com/${userId}/${name}.git`,
    localPath: name,
    sourcePath: join('/tmp/ocm-git-access', userId, name),
    branch: 'main',
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: 1,
    userId,
  } as never).id
}

/** The routes as the server mounts them: behind a session that names a person. */
function appAs(user: { id: string; role: 'admin' | 'user'; username: string } | null): Hono {
  const app = new Hono()
  if (user) {
    app.use('*', async (c, next) => {
      ;(c as unknown as { set: (k: string, v: unknown) => void }).set('user', user)
      await next()
    })
  }
  app.route('/', createRepoGitRoutes(db, gitAuth))
  return app
}

async function batch(app: Hono, repoIds: number[]): Promise<Response> {
  return app.request('/git-status-batch', {
    method: 'POST',
    headers: { 'Content-type': 'application/json' },
    body: JSON.stringify({ repoIds }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  db = new Database(':memory:')
  migrate(db, allMigrations)
})

describe('POST /git-status-batch', () => {
  it('does not describe another tenant\'s repository', async () => {
    const theirs = addRepo('u-mira', 'secret')
    const sam = { id: 'u-sam', role: 'user' as const, username: 'sam' }

    const res = await batch(appAs(sam), [theirs])

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
  })

  it('answers with only the caller\'s own repository in a mixed batch', async () => {
    const theirs = addRepo('u-mira', 'secret')
    const mine = addRepo('u-sam', 'mine')
    const sam = { id: 'u-sam', role: 'user' as const, username: 'sam' }

    const res = await batch(appAs(sam), [theirs, mine])

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    // The batch endpoint's whole purpose is refusing some of what was asked
    // for, so the refusals are visible in the shape of the answer.
    expect(Object.keys(body)).toEqual([String(mine)])
  })

  it('refuses a request it cannot place on a person, rather than serving every id', async () => {
    const repoId = addRepo('u-mira', 'secret')

    const res = await batch(appAs(null), [repoId])

    expect(res.status).toBe(401)
  })

  it('still sweeps ids for an ordinary user without widening the answer', async () => {
    // A batch is the shape that probes ids, so a wide one must come back
    // narrowed rather than refused - the check is per id, not per request.
    const ids = [addRepo('u-mira', 'a'), addRepo('u-mira', 'b'), addRepo('u-mira', 'c')]
    const sam = { id: 'u-sam', role: 'user' as const, username: 'sam' }

    const res = await batch(appAs(sam), ids)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
  })
})
