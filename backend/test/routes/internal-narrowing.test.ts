import { beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { createInternalRoutes } from '../../src/routes/internal'
import { ScheduleService } from '../../src/services/schedules'
import { NotificationService } from '../../src/services/notification'
import { SettingsService } from '../../src/services/settings'
import { createOpenCodeClient } from '../../src/services/opencode/client'
import { allMigrations } from '../../src/db/migrations'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { migrate } from '../../src/db/migration-runner'
import { recordAgentSession } from '../../src/services/agent-session'
import { SESSION_HEADER } from '../../src/auth/internal-token-middleware'
import type { ScheduleWorktreeManager } from '../../src/services/schedule-worktree'

/**
 * Narrowing the internal API by subject.
 *
 * Every case comes in a pair: what another tenant must not see, and what the
 * caller must still see. A test suite made only of the first kind passes just
 * as well when the route returns nothing at all - which is the failure mode
 * that matters most here, because an agent that cannot list its own repos
 * looks exactly like a correctly isolated one until someone uses the product.
 */

const ALICE = 'u-alice'
const BOB = 'u-bob'

describe('internal routes narrowed by session owner', () => {
  let db: Database
  let app: Hono
  let token: string

  const addUser = (id: string, username: string, role: string) => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO "user" ("id", "name", "email", "username", "role", "emailVerified", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(id, id, `${id}@example.com`, username, role, now, now)
  }

  const addRepo = (id: number, localPath: string, userId: string | null) => {
    db.prepare(
      `INSERT INTO repos (id, repo_url, local_path, default_branch, clone_status, cloned_at, user_id)
       VALUES (?, ?, ?, 'main', 'ready', ?, ?)`,
    ).run(id, `https://example.com/${localPath}.git`, localPath, Date.now(), userId)
  }

  /** A session the manager recorded, so the request can be placed. */
  const asSession = (sessionId: string) => ({
    authorization: `Bearer ${token}`,
    [SESSION_HEADER]: sessionId,
  })

  const recordSession = (sessionId: string, userId: string | null, role = 'user') => {
    recordAgentSession(db, {
      sessionId,
      userId,
      username: userId,
      role: role === 'admin' ? 'admin' : userId ? 'user' : 'unknown',
      directory: null,
      source: 'proxy',
    })
  }

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    const openCodeClient = createOpenCodeClient()
    const stub = { prepare: () => Promise.resolve(null), finalize: () => Promise.resolve({ commitHash: null }) } as unknown as ScheduleWorktreeManager
    const scheduleService = new ScheduleService(db, openCodeClient, stub)
    const notificationService = new NotificationService(db)
    const settingsService = new SettingsService(db)
    app = new Hono()
    app.route('/api/internal', createInternalRoutes(db, scheduleService, notificationService, settingsService, openCodeClient))
    token = getOrCreateInternalToken(db)

    addUser(ALICE, 'alice', 'user')
    addUser(BOB, 'bob', 'user')
    addRepo(11, 'alice-project', ALICE)
    addRepo(22, 'bob-project', BOB)
    recordSession('ses_alice', ALICE)
    recordSession('ses_bob', BOB)
  })

  // --- GET /repos ---------------------------------------------------------

  it('lists only the caller own repositories', async () => {
    const res = await app.request('/api/internal/repos', { headers: asSession('ses_alice') })
    expect(res.status).toBe(200)
    const body = await res.json() as { repos: { id: number }[] }
    expect(body.repos.map((r) => r.id)).toEqual([11])
  })

  it('refuses a shared token that names no session', async () => {
    // The whole list, unnarrowed, is what a copied token bought before. There
    // is no longer a "before" in which serving it was the compromise.
    const res = await app.request('/api/internal/repos', { headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(401)
  })

  it('keeps a shared repository visible to everyone', async () => {
    // repos.user_id IS NULL means "shared", and that is the product rule the
    // web API already follows. Narrowing must not quietly turn it into
    // "owned by nobody".
    addRepo(33, 'shared-project', null)
    const res = await app.request('/api/internal/repos', { headers: asSession('ses_alice') })
    const body = await res.json() as { repos: { id: number }[] }
    expect(body.repos.map((r) => r.id).sort()).toEqual([11, 33])
  })

  it('refuses a session with no owner rather than borrowing a neighbour view', async () => {
    // This one is not hypothetical: a schedule on a repository nobody owns is
    // recorded without a person, so it has no principal to narrow by. Falling
    // back to "everything" meant a scheduled agent on a shared repository read
    // both tenants' repositories, which is the leak the whole scheme exists to
    // close.
    recordSession('ses_ownerless', null)

    const res = await app.request('/api/internal/repos', { headers: asSession('ses_ownerless') })
    expect(res.status).toBe(401)
  })

  it('lets an administrator see every repository', async () => {
    addUser('u-root', 'root', 'admin')
    recordSession('ses_root', 'u-root', 'admin')
    const res = await app.request('/api/internal/repos', { headers: asSession('ses_root') })
    const body = await res.json() as { repos: { id: number }[] }
    expect(body.repos.map((r) => r.id).sort()).toEqual([11, 22])
  })

  // --- GET /opencode-workspaces -------------------------------------------

  it('lists only the caller own workspaces', async () => {
    const res = await app.request('/api/internal/opencode-workspaces', { headers: asSession('ses_alice') })
    expect(res.status).toBe(200)
    const body = await res.json() as { workspaces: { repoId: number }[] }
    expect(body.workspaces.map((w) => w.repoId)).toEqual([11])
  })

  it('refuses to list workspaces for a request that names no session', async () => {
    const res = await app.request('/api/internal/opencode-workspaces', { headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(401)
  })

  // --- GET/PATCH /settings ------------------------------------------------

  it('reads the caller own settings even when another user is named', async () => {
    // The stored settings can carry TTS and STT API keys, so ?userId= used to
    // be a way to read another tenant's credentials by naming them. Both users
    // get a distinguishable setting, so this asserts *which* one came back
    // rather than comparing a timestamp that a fresh row would also match.
    const service = new SettingsService(db)
    service.updateSettings({ theme: 'light' }, ALICE)
    service.updateSettings({ theme: 'dark' }, BOB)

    const res = await app.request(`/api/internal/settings?userId=${BOB}`, { headers: asSession('ses_alice') })
    expect(res.status).toBe(200)
    const body = await res.json() as { preferences: { theme?: string } }
    expect(body.preferences.theme).toBe('light')
  })

  it('writes only to the caller own settings', async () => {
    const service = new SettingsService(db)
    service.updateSettings({ theme: 'light' }, ALICE)
    service.updateSettings({ theme: 'dark' }, BOB)

    const res = await app.request(`/api/internal/settings?userId=${BOB}`, {
      method: 'PATCH',
      headers: { ...asSession('ses_alice'), 'content-type': 'application/json' },
      body: JSON.stringify({ theme: 'system' }),
    })

    expect(res.status).toBe(200)
    // Assert the setting, not the whole object: getSettings materialises a
    // missing row with a fresh updatedAt, so a whole-object comparison fails
    // on a timestamp that says nothing about ownership.
    expect(service.getSettings(BOB).preferences.theme).toBe('dark')
    expect(service.getSettings(ALICE).preferences.theme).toBe('system')
  })

  it('refuses to write another user settings for a request that names no session', async () => {
    // The `?userId=` selector is what this stage removed. Keeping it alive for
    // unplaceable callers would have left the original hole open behind a
    // middleware that happens to be installed.
    const service = new SettingsService(db)
    service.updateSettings({ theme: 'light' }, BOB)

    const res = await app.request(`/api/internal/settings?userId=${BOB}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ theme: 'dark' }),
    })
    expect(res.status).toBe(401)
    expect(service.getSettings(BOB).preferences.theme).toBe('light')
  })

  it('refuses to read another user settings for a request that names no session', async () => {
    const res = await app.request(`/api/internal/settings?userId=${BOB}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(401)
  })

  // --- GET /schedules/all and /all/runs ------------------------------------

  it('lists only the caller own schedules', async () => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO schedule_jobs (id, repo_id, name, enabled, schedule_mode, prompt, created_at, updated_at)
       VALUES (1, 11, 'alice job', 1, 'interval', 'p', ?, ?)`,
    ).run(now, now)
    db.prepare(
      `INSERT INTO schedule_jobs (id, repo_id, name, enabled, schedule_mode, prompt, created_at, updated_at)
       VALUES (2, 22, 'bob job', 1, 'interval', 'p', ?, ?)`,
    ).run(now, now)

    const res = await app.request('/api/internal/schedules/all', { headers: asSession('ses_alice') })
    expect(res.status).toBe(200)
    const body = await res.json() as { jobs: { id: number }[] }
    expect(body.jobs.map((j) => j.id)).toEqual([1])
  })

  it('does not hand one tenant another session id through the run list', async () => {
    // This is the leak that made the session id worthless as a carrier: any
    // agent could read every run's session_id and then claim it.
    const now = Date.now()
    db.prepare(
      `INSERT INTO schedule_jobs (id, repo_id, name, enabled, schedule_mode, prompt, created_at, updated_at)
       VALUES (1, 11, 'alice job', 1, 'interval', 'p', ?, ?)`,
    ).run(now, now)
    db.prepare(
      `INSERT INTO schedule_runs (job_id, repo_id, trigger_source, status, started_at, created_at, session_id)
       VALUES (1, 11, 'manual', 'completed', ?, ?, 'ses_alice')`,
    ).run(now, now)
    db.prepare(
      `INSERT INTO schedule_jobs (id, repo_id, name, enabled, schedule_mode, prompt, created_at, updated_at)
       VALUES (2, 22, 'bob job', 1, 'interval', 'p', ?, ?)`,
    ).run(now, now)
    db.prepare(
      `INSERT INTO schedule_runs (job_id, repo_id, trigger_source, status, started_at, created_at, session_id)
       VALUES (2, 22, 'manual', 'completed', ?, ?, 'ses_bob')`,
    ).run(now, now)

    const res = await app.request('/api/internal/schedules/all/runs', { headers: asSession('ses_alice') })
    const body = await res.json() as { runs: { sessionId: string | null }[] }
    expect(body.runs.map((r) => r.sessionId)).toEqual(['ses_alice'])
  })

  // --- repo-scoped schedules ----------------------------------------------

  it('refuses to touch another tenant repository schedule', async () => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO schedule_jobs (id, repo_id, name, enabled, schedule_mode, prompt, created_at, updated_at)
       VALUES (2, 22, 'bob job', 1, 'interval', 'p', ?, ?)`,
    ).run(now, now)

    const res = await app.request('/api/internal/repos/22/schedules/2/run', {
      method: 'POST',
      headers: asSession('ses_alice'),
    })
    expect(res.status).toBe(403)
  })

  it('refuses to read another tenant repository schedule', async () => {
    const res = await app.request('/api/internal/repos/22/schedules', { headers: asSession('ses_alice') })
    expect(res.status).toBe(403)
  })

  it('still serves the caller own repository schedule', async () => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO schedule_jobs (id, repo_id, name, enabled, schedule_mode, prompt, created_at, updated_at)
       VALUES (1, 11, 'alice job', 1, 'interval', 'p', ?, ?)`,
    ).run(now, now)

    const res = await app.request('/api/internal/repos/11/schedules', { headers: asSession('ses_alice') })
    expect(res.status).toBe(200)
    const body = await res.json() as { jobs: { id: number }[] }
    expect(body.jobs.map((j) => j.id)).toEqual([1])
  })

  it('lets an administrator drive any repository schedule', async () => {
    addUser('u-root', 'root', 'admin')
    recordSession('ses_root', 'u-root', 'admin')
    const res = await app.request('/api/internal/repos/22/schedules', { headers: asSession('ses_root') })
    expect(res.status).toBe(200)
  })

  it('refuses any repository schedule to a request that names no session', async () => {
    const res = await app.request('/api/internal/repos/22/schedules', { headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(401)
  })
})
