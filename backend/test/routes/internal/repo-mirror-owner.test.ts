import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { migrate } from '../../../src/db/migration-runner'
import { allMigrations } from '../../../src/db/migrations'
import { getRepoById } from '../../../src/db/queries'
import { canAccessRepo } from '../../../src/auth/ownership'
import { createInternalTokenMiddleware } from '../../../src/auth/internal-token-middleware'
import { createInternalRepoMirrorRoutes } from '../../../src/routes/internal/repo-mirror'
import { createInternalCaller } from '../../helpers/internal-caller'
import { getOrCreateInternalToken } from '../../../src/services/internal-token'
import { recordAgentSession } from '../../../src/services/agent-session'
import { SESSION_HEADER } from '../../../src/auth/internal-token-middleware'

/**
 * `POST /api/internal/repos/0/mirror/begin` with `create: true` mints a repo
 * row for a mirror upload that has not happened yet.
 *
 * It called `createRepoRow` without a `userId`, and that parameter defaults to
 * `null` - so the row landed with `user_id IS NULL`. That is not a neutral
 * "shared" state here: `canAccessRepoOwner` returns true for a null owner for
 * every non-admin, so the repository the CLI had just started mirroring was
 * immediately readable, listable and deletable by any other tenant, and its
 * directory joined the set of paths they could browse. The delete is the sharp
 * edge - it reaches the filesystem.
 *
 * The internal token names a user, so that is the owner. These tests run the
 * real route, the real token middleware and a real database, because the bug
 * lives in the seam between the three: a mocked `createRepoRow` would only
 * prove the route passes an argument, not that a row is attributed.
 */

const { mockEnsureMirrorTargetPath } = vi.hoisted(() => ({
  mockEnsureMirrorTargetPath: vi.fn(),
}))

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
    ensureMirrorTargetPath: (...args: unknown[]) => mockEnsureMirrorTargetPath(...args),
    ensureMirrorTarget: vi.fn(),
    planMirrorTarget: vi.fn(),
  }
})

vi.mock('../../../src/services/uploads/mirror-staging', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/uploads/mirror-staging')>()
  return {
    ...actual,
    // The staging area is not what this test is about, and a real one would
    // leave directories behind for every case.
    createUploadSession: vi.fn(async (meta: Record<string, unknown>) => ({ ...meta, uploadId: 'test-upload', startedAt: 1 })),
  }
})

let db: Database
let app: Hono
let tmpRoot: string

async function begin(body: Record<string, unknown>, headers: Record<string, string>): Promise<Response> {
  return app.request('/api/internal/repos/0/mirror/begin', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  db = new Database(':memory:')
  migrate(db, allMigrations)
  tmpRoot = join(tmpdir(), `mirror-owner-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mockEnsureMirrorTargetPath.mockImplementation((name: string) => ({
    localPath: name,
    fullPath: join(tmpRoot, name),
  }))

  app = new Hono()
  app.use('/*', createInternalTokenMiddleware(db))
  app.route('/api/internal/repos', createInternalRepoMirrorRoutes(db))
})

describe('a mirrored repository belongs to the person mirroring it', () => {
  it('records the calling user as the owner', async () => {
    const caller = createInternalCaller(db, { id: 'u-mira', username: 'mira' })

    const res = await begin({ create: true, name: 'RelayAB' }, { authorization: `Bearer ${caller.token}` })

    expect(res.status).toBe(200)
    const { repoId } = await res.json() as { repoId: number }
    expect(getRepoById(db, repoId)?.userId).toBe('u-mira')
  })

  it('leaves the new row out of another tenant reach', async () => {
    // The consequence, stated as the invariant it protects. `null` owner means
    // "shared", and shared means every non-admin, so this is the assertion that
    // would have caught the original row. The principals are plain ids on
    // purpose: `canAccessRepo` compares ownership, it does not look anyone up.
    const owner = createInternalCaller(db, { id: 'u-mira', username: 'mira' })

    const res = await begin({ create: true, name: 'RelayAB' }, { authorization: `Bearer ${owner.token}` })
    const { repoId } = await res.json() as { repoId: number }

    const asOwner = { id: 'u-mira', role: 'user' as const }
    const asStranger = { id: 'u-sam', role: 'user' as const }
    const asAdmin = { id: 'u-root', role: 'admin' as const }

    expect(canAccessRepo(db, repoId, asOwner)).toBe(true)
    expect(canAccessRepo(db, repoId, asStranger)).toBe(false)
    // The admin path is unchanged: an owner is not a lockout for the operator.
    expect(canAccessRepo(db, repoId, asAdmin)).toBe(true)
  })

  it('gives two people mirroring the same name two repositories', async () => {
    // `createRepoRow` already scoped its dedupe by owner; before the fix every
    // mirror row shared one namespace, so the second caller would have been
    // handed the first caller's row and then written their tar over it.
    const first = createInternalCaller(db, { id: 'u-mira', username: 'mira' })
    const second = createInternalCaller(db, { id: 'u-sam', username: 'sam' })

    const one = await (await begin({ create: true, name: 'RelayAB' }, { authorization: `Bearer ${first.token}` })).json() as { repoId: number; created: boolean }
    const two = await (await begin({ create: true, name: 'RelayAB' }, { authorization: `Bearer ${second.token}` })).json() as { repoId: number; created: boolean }

    expect(one.created).toBe(true)
    expect(two.created).toBe(true)
    expect(two.repoId).not.toBe(one.repoId)
    expect(getRepoById(db, one.repoId)?.userId).toBe('u-mira')
    expect(getRepoById(db, two.repoId)?.userId).toBe('u-sam')
  })

  it('refuses a plugin-token request that cannot be placed on a user', async () => {
    // The shared token is not a person. A plugin request with no session
    // header is turned away by the middleware, which is what stops the shared
    // namespace from being reachable at all rather than merely unused.
    const res = await begin(
      { create: true, name: 'RelayAB' },
      { authorization: `Bearer ${getOrCreateInternalToken(db)}` },
    )

    expect(res.status).toBe(401)
    expect(mockEnsureMirrorTargetPath).not.toHaveBeenCalled()
  })

  it('accepts a plugin-token request that names its session, and owns the row to that user', async () => {
    // The supported path for a plugin: the shared token plus the session it is
    // running in. Ownership follows the session, not the token.
    const owner = createInternalCaller(db, { id: 'u-mira', username: 'mira' })
    const sessionId = 'ses_plugin_owned'
    // The row a plugin registers so a shared-token request can be placed on a
    // person. Inserted the way the service does, because the middleware reads
    // the role and the name off this row rather than off the token.
    recordAgentSession(db, {
      sessionId,
      userId: owner.userId,
      username: owner.username,
      role: 'user',
      directory: join(tmpRoot, 'RelayAB'),
      source: 'proxy',
    })

    const res = await begin(
      { create: true, name: 'RelayAB' },
      { authorization: `Bearer ${getOrCreateInternalToken(db)}`, [SESSION_HEADER]: sessionId },
    )

    expect(res.status).toBe(200)
    const { repoId } = await res.json() as { repoId: number }
    expect(getRepoById(db, repoId)?.userId).toBe('u-mira')
  })
})
