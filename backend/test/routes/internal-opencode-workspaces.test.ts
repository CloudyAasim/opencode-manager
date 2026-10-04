import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { createInternalRoutes } from '../../src/routes/internal'
import type { ScheduleService } from '../../src/services/schedules'
import type { NotificationService } from '../../src/services/notification'
import type { SettingsService } from '../../src/services/settings'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { Repo } from '../../src/types/repo'

const mockDb = {
  prepare: vi.fn().mockReturnValue({
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(),
  }),
  exec: vi.fn(),
  close: vi.fn(),
  transaction: vi.fn((fn: () => void) => fn()),
} as unknown as Database

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(() => mockDb),
}))

const mockListRepos = vi.fn()
vi.mock('../../src/db/queries', async () => {
  const { getRepoDisplayName } = await vi.importActual<typeof import('@opencode-manager/shared/utils')>('@opencode-manager/shared/utils')
  return {
    listRepos: (...args: unknown[]) => mockListRepos(...args),
    getRepoName: (repo: Parameters<typeof getRepoDisplayName>[0]) => getRepoDisplayName(repo),
  }
})

vi.mock('../../src/db/migration-runner', () => ({
  migrate: vi.fn(),
}))

/**
 * Hoisted, because a `vi.mock` factory is lifted above the module body and
 * would otherwise close over a binding that is still in its temporal dead
 * zone. Re-primed in the describe below, because `vi.clearAllMocks()` is the
 * only thing standing between these handles and a shared previous test's
 * answer.
 */
const { USER_TOKEN, findUserIdByToken, findUserIdentity, accessibleRepoIds } = vi.hoisted(() => ({
  USER_TOKEN: 'test-user-token',
  findUserIdByToken: vi.fn<(provided: string) => string | null>(() => null),
  findUserIdentity: vi.fn<(...args: unknown[]) => unknown>(() => null),
  accessibleRepoIds: vi.fn<(...args: unknown[]) => number[]>(() => []),
}))

vi.mock('../../src/services/internal-token', () => ({
  getOrCreateInternalToken: vi.fn().mockReturnValue('test-internal-token'),
  findUserIdByToken,
}))

/**
 * The workspace shape is what this suite is about, so the caller is an admin
 * and can see every repository. Which repositories a given tenant may see is
 * internal-narrowing.test.ts's subject, and asserting it here as well would
 * only give the same rule a second place to drift.
 */
vi.mock('../../src/auth/ownership', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/auth/ownership')>()),
  findUserIdentity,
  accessibleRepoIds,
}))

vi.mock('../../src/services/schedules', () => ({
  ScheduleService: vi.fn(),
}))

vi.mock('../../src/services/notification', () => ({
  NotificationService: vi.fn(),
}))

vi.mock('../../src/services/settings', () => ({
  SettingsService: vi.fn(),
}))

vi.mock('../../src/services/opencode/client', () => ({
  createOpenCodeClient: vi.fn(),
}))

function makeRepo(overrides: Partial<Repo>): Repo {
  return {
    id: 1,
    localPath: 'test-repo',
    fullPath: '/tmp/test-repo',
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: Date.now(),
    ...overrides,
  }
}

describe('internal-opencode-workspaces routes', () => {
  let app: Hono
  let token: string

  beforeEach(() => {
    vi.clearAllMocks()
    // `mockReturnValue`, not `mockImplementation` - see the note in
    // opencode-proxy.test.ts, which measured the difference.
    findUserIdByToken.mockReturnValue('u-workspaces')
    findUserIdentity.mockReturnValue({ id: 'u-workspaces', role: 'admin', username: 'workspaces' })
    accessibleRepoIds.mockReturnValue([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    mockListRepos.mockReturnValue([])
    const scheduleService = {} as ScheduleService
    const notificationService = {} as NotificationService
    const settingsService = {} as SettingsService
    const openCodeClient = {
      forward: vi.fn(),
      forwardRaw: vi.fn(),
      getJson: vi.fn(),
      postJson: vi.fn(),
      setProviderAuth: vi.fn(),
      deleteProviderAuth: vi.fn(),
    } as unknown as OpenCodeClient
    app = new Hono()
    app.route('/api/internal', createInternalRoutes(mockDb, scheduleService, notificationService, settingsService, openCodeClient))
    token = USER_TOKEN
  })

  it('GET /api/internal/opencode-workspaces returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/opencode-workspaces')
    expect(res.status).toBe(401)
  })

  it('GET /api/internal/opencode-workspaces returns 200 with bearer token', async () => {
    const res = await app.request('/api/internal/opencode-workspaces', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { workspaces: unknown[] }
    expect(body).toHaveProperty('workspaces')
    expect(Array.isArray(body.workspaces)).toBe(true)
  })

  it('GET /api/internal/opencode-workspaces only returns ready repos', async () => {
    mockListRepos.mockReturnValue([
      makeRepo({ id: 1, cloneStatus: 'ready', localPath: 'ready-repo' }),
      makeRepo({ id: 2, cloneStatus: 'cloning', localPath: 'cloning-repo' }),
      makeRepo({ id: 3, cloneStatus: 'error', localPath: 'error-repo' }),
    ])

    const res = await app.request('/api/internal/opencode-workspaces', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { workspaces: Array<{ repoId: number; cloneStatus: string }> }
    expect(body.workspaces.length).toBe(1)
    expect(body.workspaces[0]?.cloneStatus).toBe('ready')
    expect(body.workspaces[0]?.repoId).toBeDefined()
  })

  it('GET /api/internal/opencode-workspaces returns workspace structure', async () => {
    mockListRepos.mockReturnValue([
      makeRepo({ id: 1, localPath: 'test-repo', cloneStatus: 'ready' }),
      makeRepo({ id: 2, localPath: 'worktree-repo', cloneStatus: 'ready', isWorktree: true }),
    ])

    const res = await app.request('/api/internal/opencode-workspaces', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { workspaces: Array<{ repoId: number; name: string; branch: string | null; cloneStatus: string; directory: string; isWorktree: boolean; extra: { repoId: number; localPath: string; fullPath: string } }> }
    expect(body.workspaces.length).toBe(2)
    const workspace = body.workspaces.find((w) => w.repoId === 1)!
    expect(workspace).toHaveProperty('repoId')
    expect(workspace).toHaveProperty('name')
    expect(workspace).toHaveProperty('branch')
    expect(workspace).toHaveProperty('cloneStatus')
    expect(workspace).toHaveProperty('directory')
    expect(workspace).toHaveProperty('projectId')
    expect(workspace).toHaveProperty('extra')
    expect(workspace.extra).toHaveProperty('repoId')
    expect(workspace.extra).toHaveProperty('localPath')
    expect(workspace.extra).toHaveProperty('fullPath')
    const worktreeWorkspace = body.workspaces.find((w) => w.repoId === 2)!
    expect(workspace.isWorktree).toBe(false)
    expect(worktreeWorkspace.isWorktree).toBe(true)
  })
})
