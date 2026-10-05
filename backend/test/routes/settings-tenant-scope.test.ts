import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { Database } from 'bun:sqlite'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { createSettingsRoutes } from '../../src/routes/settings'
import { setOpenCodeRestartCoordinator } from '../../src/services/opencode-restart'
import type { OpenCodeRestartCoordinator } from '../../src/services/opencode-restart-coordinator'
import type { GitAuthService } from '../../src/services/git-auth'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { getUserWorkspacePath, getWorkspacePath } from '@opencode-manager/shared/config/env'

/**
 * Two settings routes used to answer with more than the caller owns.
 *
 * `GET /settings/skills?directory=…` forwarded the directory straight to
 * OpenCode's `/skill`, so any signed-in user could name any directory on the
 * host and read back the `.opencode` tree under it; `repoId` on the same route
 * skipped the ownership check one indirection out. `GET
 * /settings/opencode-active-sessions` is a pure read of one shared OpenCode
 * process, and it returned every tenant's sessions with their absolute
 * directories attached.
 *
 * Both now measure the caller's own roots. A request that cannot be attributed
 * is refused rather than served as somebody, which is the half that no
 * positive-path test can reach.
 */

let db: Database
let workspaceRoot: string
let previousWorkspacePath: string | undefined
let routes: ReturnType<typeof createSettingsRoutes>

const mockListManagedSkills = vi.hoisted(() => vi.fn())

vi.mock('../../src/services/skills', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/skills')>()
  return { ...actual, listManagedSkills: mockListManagedSkills }
})

function setUser(c: Context, user: { id: string; role: 'admin' | 'user'; username: string | null }): void {
  (c as unknown as { set: (key: string, value: unknown) => void }).set('user', user)
}

/**
 * Mounts the routes behind a caller, the way the session middleware does.
 *
 * `WORKSPACE_PATH` is a getter on the env object rather than a value read once,
 * so pointing it at the temp tree makes `getUserWorkspacePath` and everything
 * built on it resolve inside this test and nowhere else.
 */
function asUser(user: { id: string; role: 'admin' | 'user'; username: string | null }): Hono {
  const wrapper = new Hono()
  wrapper.use('*', async (c, next) => {
    setUser(c, user)
    await next()
  })
  wrapper.route('/settings', routes)
  return wrapper
}

const ALICE = { id: 'u-alice', role: 'user' as const, username: 'alice' }
const BOB = { id: 'u-bob', role: 'user' as const, username: 'bob' }
const ADMIN = { id: 'u-admin', role: 'admin' as const, username: 'admin' }

/** The same mount with no session at all, which is what "nobody" looks like. */
function anonymous(): Hono {
  const wrapper = new Hono()
  wrapper.route('/settings', routes)
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  previousWorkspacePath = process.env.WORKSPACE_PATH
  workspaceRoot = mkdtempSync(path.join(tmpdir(), 'ocm-settings-scope-'))
  process.env.WORKSPACE_PATH = workspaceRoot

  db = new Database(':memory:')
  migrate(db, allMigrations)
  routes = createSettingsRoutes(
    db,
    { getGitEnvironment: vi.fn().mockReturnValue({}) } as unknown as GitAuthService,
    createStubOpenCodeClient() as OpenCodeClient,
  )
})

afterEach(() => {
  setOpenCodeRestartCoordinator(null)
  db.close()
  rmSync(workspaceRoot, { recursive: true, force: true })
  if (previousWorkspacePath === undefined) {
    delete process.env.WORKSPACE_PATH
  } else {
    process.env.WORKSPACE_PATH = previousWorkspacePath
  }
})

function userDir(username: string, ...rest: string[]): string {
  const dir = path.join(getUserWorkspacePath(username), ...rest)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('GET /settings/skills — the directory has to be the caller own', () => {
  it('refuses a directory in another tenant workspace', async () => {
    const foreign = userDir('bob', 'RelayAB')
    mockListManagedSkills.mockResolvedValue([])

    const res = await asUser(ALICE).request(`/settings/skills?directory=${encodeURIComponent(foreign)}`)

    expect(res.status).toBe(403)
    // The point of refusing: the service is never asked, so the directory is
    // never read. A 403 after a read would still have leaked whatever it found.
    expect(mockListManagedSkills).not.toHaveBeenCalled()
  })

  it('refuses a directory anywhere else on the host', async () => {
    const outside = path.join(workspaceRoot, 'not-a-tenant-workspace')
    mkdirSync(outside, { recursive: true })
    mockListManagedSkills.mockResolvedValue([])

    const res = await asUser(ALICE).request(`/settings/skills?directory=${encodeURIComponent(outside)}`)

    expect(res.status).toBe(403)
    expect(mockListManagedSkills).not.toHaveBeenCalled()
  })

  it('refuses a traversal out of the caller own workspace', async () => {
    // As a string, not via `path.join`: the route measures the directory as it
    // arrives, so a check that ran before resolution would pass this.
    const bobDir = userDir('bob', 'RelayAB')
    const sneaky = `${getUserWorkspacePath('alice')}/../../../bob/RelayAB`
    mockListManagedSkills.mockResolvedValue([])

    const res = await asUser(ALICE).request(`/settings/skills?directory=${encodeURIComponent(sneaky)}`)

    expect(res.status).toBe(403)
    expect(mockListManagedSkills).not.toHaveBeenCalled()
    expect(mockListManagedSkills).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), bobDir)
  })

  it('still lists skills for a directory inside the caller own workspace', async () => {
    // The positive half. Without it, "always 403" would satisfy everything
    // above and the route would be dead rather than safe.
    const own = userDir('alice', 'RelayAB')
    const skills = [{ name: 'review', description: 'Review changes', body: 'b', scope: 'project' as const, location: own }]
    mockListManagedSkills.mockResolvedValue(skills)

    const res = await asUser(ALICE).request(`/settings/skills?directory=${encodeURIComponent(own)}`)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(skills)
    expect(mockListManagedSkills).toHaveBeenCalledWith(db, expect.anything(), undefined, own)
  })

  it('refuses an unattributable request rather than serving it as somebody', async () => {
    const own = userDir('alice', 'RelayAB')
    mockListManagedSkills.mockResolvedValue([])

    // No wrapper at all: the bare routes, which is what every call looked like
    // before the session middleware was modelled in the test app.
    const res = await anonymous().request(`/settings/skills?directory=${encodeURIComponent(own)}`)

    expect(res.status).toBe(403)
    expect(mockListManagedSkills).not.toHaveBeenCalled()
  })

  it('leaves an admin the whole workspace', async () => {
    // A roots-based filter that is wrong in the restrictive direction would
    // still pass the refusals above; this is the half that shows the route did
    // not simply stop asking.
    const anywhere = path.join(getWorkspacePath(), 'repos', 'RelayAB')
    mockListManagedSkills.mockResolvedValue([])

    const res = await asUser(ADMIN).request(`/settings/skills?directory=${encodeURIComponent(anywhere)}`)

    expect(res.status).toBe(200)
    expect(mockListManagedSkills).toHaveBeenCalledWith(db, expect.anything(), undefined, anywhere)
  })
})

describe('GET /settings/skills — the repo id has to be the caller own', () => {
  it('refuses a repo owned by somebody else', async () => {
    const { createRepo } = await import('../../src/db/queries')
    const theirs = createRepo(db, {
      isLocal: true,
      localPath: 'RelayAB',
      sourcePath: userDir('bob', 'RelayAB'),
      branch: 'main',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      userId: BOB.id,
    })
    mockListManagedSkills.mockResolvedValue([])

    const res = await asUser(ALICE).request(`/settings/skills?repoId=${theirs.id}`)

    expect(res.status).toBe(403)
    expect(mockListManagedSkills).not.toHaveBeenCalled()
  })

  it('still lists skills for a repo the caller owns', async () => {
    const { createRepo } = await import('../../src/db/queries')
    const mine = createRepo(db, {
      isLocal: true,
      localPath: 'RelayAB',
      sourcePath: userDir('alice', 'RelayAB'),
      branch: 'main',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      userId: ALICE.id,
    })
    const skills = [{ name: 'review', description: 'Review changes', body: 'b', scope: 'project' as const, location: mine.sourcePath }]
    mockListManagedSkills.mockResolvedValue(skills)

    const res = await asUser(ALICE).request(`/settings/skills?repoId=${mine.id}`)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(skills)
    expect(mockListManagedSkills).toHaveBeenCalledWith(db, expect.anything(), mine.id, undefined)
  })
})

describe('GET /settings/opencode-active-sessions — the directory is the only owner a worktree has', () => {
  function stubCoordinator(sessions: Array<{ sessionID: string; directory: string }>): void {
    setOpenCodeRestartCoordinator({
      captureResumableSessions: vi.fn(() => sessions),
    } as unknown as OpenCodeRestartCoordinator)
  }

  it('drops another tenant session and its directory', async () => {
    const mineDir = userDir('alice', 'RelayAB')
    const theirDir = userDir('bob', 'SecretRepo')
    stubCoordinator([
      { sessionID: 's-mine', directory: mineDir },
      { sessionID: 's-theirs', directory: theirDir },
    ])

    const res = await asUser(ALICE).request('/settings/opencode-active-sessions')
    const body = await res.json() as { count: number; sessions: Array<{ sessionID: string }> }

    expect(res.status).toBe(200)
    expect(body.count).toBe(1)
    expect(body.sessions).toEqual([{ sessionID: 's-mine', directory: mineDir }])
    // Asserted on the raw body: `count: 1` alone would also pass if the route
    // truncated the array after filling it, and the directory is the leak.
    expect(JSON.stringify(body)).not.toContain(theirDir)
    expect(JSON.stringify(body)).not.toContain('s-theirs')
  })

  it('drops a session from a directory outside every tenant workspace', async () => {
    const mineDir = userDir('alice', 'RelayAB')
    const stray = path.join(workspaceRoot, 'stray')
    mkdirSync(stray, { recursive: true })
    stubCoordinator([
      { sessionID: 's-mine', directory: mineDir },
      { sessionID: 's-stray', directory: stray },
    ])

    const res = await asUser(ALICE).request('/settings/opencode-active-sessions')
    const body = await res.json() as { sessions: Array<{ sessionID: string }> }

    expect(body.sessions.map((session) => session.sessionID)).toEqual(['s-mine'])
  })

  it('still shows a caller their own session', async () => {
    // The positive half again - a filter that returned nothing for everyone
    // would pass both refusals above.
    const mineDir = userDir('alice', 'RelayAB')
    stubCoordinator([{ sessionID: 's-mine', directory: mineDir }])

    const res = await asUser(ALICE).request('/settings/opencode-active-sessions')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 1, sessions: [{ sessionID: 's-mine', directory: mineDir }] })
  })

  it('gives each tenant only their own, and neither sees the other', async () => {
    const aliceDir = userDir('alice', 'RelayAB')
    const bobDir = userDir('bob', 'SecretRepo')
    stubCoordinator([
      { sessionID: 's-alice', directory: aliceDir },
      { sessionID: 's-bob', directory: bobDir },
    ])

    const asAlice = await (await asUser(ALICE).request('/settings/opencode-active-sessions')).json() as { sessions: Array<{ sessionID: string }> }
    const asBob = await (await asUser(BOB).request('/settings/opencode-active-sessions')).json() as { sessions: Array<{ sessionID: string }> }

    expect(asAlice.sessions.map((session) => session.sessionID)).toEqual(['s-alice'])
    expect(asBob.sessions.map((session) => session.sessionID)).toEqual(['s-bob'])
  })

  it('leaves an admin the unfiltered view', async () => {
    const mineDir = userDir('alice', 'RelayAB')
    const theirDir = userDir('bob', 'SecretRepo')
    stubCoordinator([
      { sessionID: 's-mine', directory: mineDir },
      { sessionID: 's-theirs', directory: theirDir },
    ])

    const res = await asUser(ADMIN).request('/settings/opencode-active-sessions')
    const body = await res.json() as { count: number }

    expect(body.count).toBe(2)
  })

  it('refuses an unattributable request', async () => {
    const mineDir = userDir('alice', 'RelayAB')
    stubCoordinator([{ sessionID: 's-mine', directory: mineDir }])

    const res = await anonymous().request('/settings/opencode-active-sessions')

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
  })
})
