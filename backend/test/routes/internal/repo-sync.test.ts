import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { migrate } from '../../../src/db/migration-runner'
import { allMigrations } from '../../../src/db/migrations'
import { createRepo } from '../../../src/db/queries'
import { createInternalTokenMiddleware } from '../../../src/auth/internal-token-middleware'
import { createInternalRepoSyncRoutes } from '../../../src/routes/internal/repo-sync'
import { createInternalCaller } from '../../helpers/internal-caller'

/**
 * `GET /:repoId/git-info` looked the row up with `getRepoById`, which does not
 * filter by owner, and nothing between the token middleware and the handler
 * checked - the same gap the mirror routes had, in a route that had no test at
 * all, which is presumably why it survived.
 *
 * What it hands over is not only a name and a branch: `originUrl` is
 * `git remote get-url origin`, which is whatever the repository was cloned
 * with. A repository cloned from `https://user:token@host/...` still carries
 * that in its config.
 */

const safeGitOut = vi.hoisted(() => vi.fn())

vi.mock('../../../src/services/git/git-commands', () => ({
  safeGitOut: (...args: unknown[]) => safeGitOut(...args),
  gitOut: (...args: unknown[]) => safeGitOut(...args),
}))

let db: Database
let app: Hono

function addRepo(userId: string, name: string): number {
  const repo = createRepo(db, {
    repoUrl: `https://github.com/${userId}/${name}.git`,
    localPath: name,
    sourcePath: join('/workspace', userId, name),
    branch: 'main',
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: 1,
    userId,
  } as never)
  return repo.id
}

beforeEach(() => {
  vi.clearAllMocks()
  db = new Database(':memory:')
  migrate(db, allMigrations)
  safeGitOut.mockResolvedValue('main')

  app = new Hono()
  app.use('/*', createInternalTokenMiddleware(db))
  app.route('/api/internal/repos', createInternalRepoSyncRoutes(db))
})

describe('internal repo-sync /:repoId/git-info', () => {
  it('does not describe another tenant\'s repository', async () => {
    const repoId = addRepo('u-mira', 'secret')
    const sam = createInternalCaller(db, { id: 'u-sam', username: 'sam' })

    const res = await app.request(`/api/internal/repos/${repoId}/git-info`, {
      headers: { authorization: `Bearer ${sam.token}` },
    })

    // 404 rather than 403, so the status is not an oracle for which
    // repositories exist.
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('u-mira')
  })

  it('answers its owner', async () => {
    const repoId = addRepo('u-mira', 'secret')
    const mira = createInternalCaller(db, { id: 'u-mira', username: 'mira' })

    const res = await app.request(`/api/internal/repos/${repoId}/git-info`, {
      headers: { authorization: `Bearer ${mira.token}` },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { repoId: number; directory: string }
    expect(body.repoId).toBe(repoId)
  })

  it('withholds an origin URL that still carries a credential', async () => {
    // The repository was cloned with the token in the URL, so it is in the
    // remote config - and this endpoint reads that config.
    const repoId = addRepo('u-mira', 'secret')
    safeGitOut.mockImplementation(async (_dir: string, args: string[]) =>
      args.includes('remote') ? 'https://mira:ghp_SECRET@github.com/u-mira/secret.git' : 'main')
    const sam = createInternalCaller(db, { id: 'u-sam', username: 'sam' })

    const res = await app.request(`/api/internal/repos/${repoId}/git-info`, {
      headers: { authorization: `Bearer ${sam.token}` },
    })

    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('ghp_SECRET')
  })

  it('refuses when no caller is attributed', async () => {
    const repoId = addRepo('u-mira', 'secret')
    const bare = new Hono()
    bare.route('/api/internal/repos', createInternalRepoSyncRoutes(db))

    const res = await bare.request(`/api/internal/repos/${repoId}/git-info`)

    expect(res.status).toBe(404)
  })
})
