import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { migrate } from '../../../src/db/migration-runner'
import { allMigrations } from '../../../src/db/migrations'
import { getRepoById } from '../../../src/db/queries'
import { createInternalTokenMiddleware } from '../../../src/auth/internal-token-middleware'
import { createInternalRepoMirrorRoutes } from '../../../src/routes/internal/repo-mirror'
import { createInternalCaller } from '../../helpers/internal-caller'

/**
 * `repo-mirror-owner.test.ts` covers the *creation* path: `/mirror/begin` with
 * `create: true` used to mint rows with `user_id IS NULL`, and since a null
 * owner means "shared", the repository just mirrored was readable, listable
 * and deletable by anyone.
 *
 * This covers the other direction. Creation now attributes the row to the
 * caller - but every endpoint that takes an *existing* `repoId` looks the row up
 * with `getRepoById`, which does not filter by owner. The internal token
 * middleware puts the caller on the context so the web API's ownership filters
 * apply; nothing here applies them.
 *
 * So the two halves disagree: a row is attributed correctly and then reachable
 * by anyone who can guess its id. `GET /:repoId/mirror/head` is the cheapest
 * witness - `safeGitOut` is stubbed, so a request that is *allowed* returns 200
 * with the repository's branch and head, and no filesystem is involved.
 */

vi.mock('../../../src/services/sse-aggregator', () => ({
  sseAggregator: { getActiveDirectories: () => [] },
}))

vi.mock('../../../src/services/git/git-commands', () => ({
  gitOut: async () => 'main',
  safeGitOut: async () => 'main',
}))

vi.mock('../../../src/services/repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/repo')>()
  return {
    ...actual,
    ensureMirrorTargetPath: (name: string) => ({
      localPath: name,
      fullPath: join('/nonexistent-test-root', name),
    }),
    ensureMirrorTarget: vi.fn(),
    planMirrorTarget: vi.fn(),
  }
})

vi.mock('../../../src/services/uploads/mirror-staging', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/uploads/mirror-staging')>()
  return {
    ...actual,
    createUploadSession: vi.fn(async (meta: Record<string, unknown>) => ({ ...meta, uploadId: 'test-upload', startedAt: 1 })),
  }
})

let db: Database
let app: Hono

beforeEach(() => {
  vi.clearAllMocks()
  db = new Database(':memory:')
  migrate(db, allMigrations)

  app = new Hono()
  app.use('/*', createInternalTokenMiddleware(db))
  app.route('/api/internal/repos', createInternalRepoMirrorRoutes(db))
})

/** Mira mirrors a repository, which is what gives her a row to own. */
async function miraOwnsARepo(): Promise<{ repoId: number; token: string }> {
  const mira = createInternalCaller(db, { id: 'u-mira', username: 'mira' })
  const res = await app.request('/api/internal/repos/0/mirror/begin', {
    method: 'POST',
    body: JSON.stringify({ create: true, name: 'RelayAB' }),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${mira.token}` },
  })
  expect(res.status).toBe(200)
  const { repoId } = await res.json() as { repoId: number }
  // The premise: the row really is hers, so a refusal below is a decision and
  // not an accident of attribution.
  expect(getRepoById(db, repoId)?.userId).toBe('u-mira')
  return { repoId, token: mira.token }
}

describe('an existing mirror belongs to the person who mirrored it', () => {
  it('does not tell another tenant what its branch and head are', async () => {
    const { repoId } = await miraOwnsARepo()
    const sam = createInternalCaller(db, { id: 'u-sam', username: 'sam' })

    const res = await app.request(`/api/internal/repos/${repoId}/mirror/head`, {
      headers: { authorization: `Bearer ${sam.token}` },
    })

    // 404 rather than 403, so the status is not an oracle for which
    // repositories exist on this server - the same reasoning the web API's
    // guard records.
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('branch')
  })

  it('answers a repository that is not yours exactly as one that does not exist', async () => {
    // The invariant behind the 404. If these two ever differ, a stranger can
    // sweep ids and learn which repositories exist.
    const { repoId } = await miraOwnsARepo()
    const sam = createInternalCaller(db, { id: 'u-sweep', username: 'sweep' })

    const notYours = await app.request(`/api/internal/repos/${repoId}/mirror/head`, {
      headers: { authorization: `Bearer ${sam.token}` },
    })
    const doesNotExist = await app.request('/api/internal/repos/999999/mirror/head', {
      headers: { authorization: `Bearer ${sam.token}` },
    })

    expect(notYours.status).toBe(doesNotExist.status)
    expect(await notYours.text()).toBe(await doesNotExist.text())
  })

  it('does not answer a mirror-target plan for another tenant', async () => {
    const { repoId } = await miraOwnsARepo()
    const sam = createInternalCaller(db, { id: 'u-sam2', username: 'sam2' })

    const res = await app.request(`/api/internal/repos/${repoId}/mirror/target?branch=main`, {
      headers: { authorization: `Bearer ${sam.token}` },
    })

    expect(res.status).toBe(404)
  })

  /**
   * The token middleware is what guarantees a caller is attributed; mounted
   * without it, the guard is on its own. The claim that it fails closed rather
   * than open is otherwise untested - flipping that branch to `!principal ||`
   * kept every other test green, because no other test ever reaches it.
   */
  it('refuses rather than allows when no caller is attributed', async () => {
    const { repoId } = await miraOwnsARepo()

    const bare = new Hono()
    bare.route('/api/internal/repos', createInternalRepoMirrorRoutes(db))

    const res = await bare.request(`/api/internal/repos/${repoId}/mirror/head`)

    expect(res.status).toBe(404)
  })

  it('still answers its owner', async () => {
    const { repoId, token } = await miraOwnsARepo()

    const res = await app.request(`/api/internal/repos/${repoId}/mirror/head`, {
      headers: { authorization: `Bearer ${token}` },
    })

    // Proves the refusals above are the guard and not a broken fixture: the
    // same request from the owner gets the repository's own metadata.
    expect(res.status).toBe(200)
    const body = await res.json() as { repoId: number; branch: string | null }
    expect(body.repoId).toBe(repoId)
  })
})
