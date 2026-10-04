import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { ScheduleServiceError } from '../../src/services/schedules'

const scheduleService = {
  listJobs: vi.fn(),
  createJob: vi.fn(),
  getJob: vi.fn(),
  updateJob: vi.fn(),
  deleteJob: vi.fn(),
  runJob: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  cancelRun: vi.fn(),
  clearRunHistory: vi.fn(),
  deleteRun: vi.fn(),
  listAllEnabledJobs: vi.fn(),
  listAllJobsWithRepos: vi.fn(),
  listAllRuns: vi.fn(),
  recoverRunningRuns: vi.fn(),
  setJobChangeHandler: vi.fn(),
}

vi.mock('../../src/services/schedules', async () => {
  const actual = await vi.importActual('../../src/services/schedules')
  return {
    ...actual,
    ScheduleService: vi.fn().mockImplementation(() => scheduleService),
  }
})

vi.mock('../../src/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

import { createScheduleRoutes } from '../../src/routes/schedules'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'

/**
 * The factory used to be mounted against an empty object, which only worked
 * because nothing asked the database anything. The ownership guard asks one
 * question - who owns this repository - and a shared row answers it, so this
 * is the smallest thing that lets the suite keep the subject it was written
 * about. The ownership cases below use a real database instead.
 */
const testDb = {
  prepare: () => ({ get: () => ({ user_id: null }) }),
} as unknown as Database

/**
 * The web API mounts these routes under `requireAuth` and the internal API
 * behind the token middleware, so in the running product every request that
 * reaches a handler already has a subject. This suite mounted the factory
 * bare, which quietly relied on the "no subject, no narrowing" branch these
 * tests were never looking at. It now supplies a subject the way the app does,
 * and the ownership cases get their own describe below.
 */
function asUser(c: Context, user: { id: string; role: 'admin' | 'user' }): void {
  c.set('user', { ...user, name: user.id, email: `${user.id}@example.test` })
}

describe('Schedule Routes', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    app = new Hono()
    // The shim sits on the same app as the mount rather than wrapping it: a
    // second `route()` would strip the path segment the handlers match on.
    app.use('*', async (c, next) => {
      asUser(c, { id: 'u-web', role: 'admin' })
      await next()
    })
    app.route('/repos/:id/schedules', createScheduleRoutes(
      scheduleService as unknown as import('../../src/services/schedules').ScheduleService,
      testDb,
    ))
  })

  it('lists jobs for a repo', async () => {
    scheduleService.listJobs.mockReturnValue([{ id: 7, name: 'Weekly engineering summary' }])

    const response = await app.request('/repos/42/schedules')
    const body = await response.json() as { jobs: Array<{ id: number }> }

    expect(response.status).toBe(200)
    expect(body.jobs).toHaveLength(1)
    expect(scheduleService.listJobs).toHaveBeenCalledWith(42)
  })

  it('creates a schedule from a valid request body', async () => {
    scheduleService.createJob.mockReturnValue({ id: 7, name: 'Daily release summary' })

    const response = await app.request('/repos/42/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Daily release summary',
        enabled: true,
        scheduleMode: 'interval',
        intervalMinutes: 60,
        prompt: 'Summarize release readiness.',
      }),
    })
    const body = await response.json() as { job: { id: number } }

    expect(response.status).toBe(201)
    expect(body.job.id).toBe(7)
    expect(scheduleService.createJob).toHaveBeenCalledWith(42, expect.objectContaining({ name: 'Daily release summary' }))
  })

  it('runs a schedule manually', async () => {
    scheduleService.runJob.mockResolvedValue({ id: 5, status: 'running' })

    const response = await app.request('/repos/42/schedules/7/run', {
      method: 'POST',
    })
    const body = await response.json() as { run: { id: number; status: string } }

    expect(response.status).toBe(200)
    expect(body.run).toEqual({ id: 5, status: 'running' })
    expect(scheduleService.runJob).toHaveBeenCalledWith(42, 7, 'manual')
  })

  it('cancels a running schedule run', async () => {
    scheduleService.cancelRun.mockResolvedValue({ id: 5, status: 'cancelled' })

    const response = await app.request('/repos/42/schedules/7/runs/5/cancel', {
      method: 'POST',
    })
    const body = await response.json() as { run: { status: string } }

    expect(response.status).toBe(200)
    expect(body.run.status).toBe('cancelled')
    expect(scheduleService.cancelRun).toHaveBeenCalledWith(42, 7, 5)
  })

  it('maps service conflicts to HTTP 409 responses', async () => {
    scheduleService.runJob.mockRejectedValue(new ScheduleServiceError('Schedule is already running', 409))

    const response = await app.request('/repos/42/schedules/7/run', {
      method: 'POST',
    })
    const body = await response.json() as { error: string }

    expect(response.status).toBe(409)
    expect(body.error).toBe('Schedule is already running')
  })

  it('returns 400 for invalid route ids before reaching the service', async () => {
    const response = await app.request('/repos/not-a-number/schedules')
    const body = await response.json() as { error: string }

    expect(response.status).toBe(400)
    expect(body.error).toBe('Invalid repo id')
    expect(scheduleService.listJobs).not.toHaveBeenCalled()
  })

  it('loads and updates a single schedule job', async () => {
    scheduleService.getJob.mockReturnValue({ id: 7, name: 'Weekly engineering summary' })
    scheduleService.updateJob.mockReturnValue({ id: 7, name: 'Updated engineering summary' })

    const getResponse = await app.request('/repos/42/schedules/7')
    const getBody = await getResponse.json() as { job: { name: string } }

    const patchResponse = await app.request('/repos/42/schedules/7', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated engineering summary' }),
    })
    const patchBody = await patchResponse.json() as { job: { name: string } }

    expect(getResponse.status).toBe(200)
    expect(getBody.job.name).toBe('Weekly engineering summary')
    expect(patchResponse.status).toBe(200)
    expect(patchBody.job.name).toBe('Updated engineering summary')
  })

  it('lists runs, loads a single run, and deletes a schedule', async () => {
    scheduleService.listRuns.mockReturnValue([{ id: 5, status: 'completed' }])
    scheduleService.getRun.mockReturnValue({ id: 5, status: 'completed' })
    scheduleService.deleteJob.mockReturnValue(undefined)

    const runsResponse = await app.request('/repos/42/schedules/7/runs?limit=5')
    const runsBody = await runsResponse.json() as { runs: Array<{ id: number }> }

    const runResponse = await app.request('/repos/42/schedules/7/runs/5')
    const runBody = await runResponse.json() as { run: { id: number } }

    const deleteResponse = await app.request('/repos/42/schedules/7', {
      method: 'DELETE',
    })
    const deleteBody = await deleteResponse.json() as { success: boolean }

    expect(runsResponse.status).toBe(200)
    expect(runsBody.runs[0]?.id).toBe(5)
    expect(runResponse.status).toBe(200)
    expect(runBody.run.id).toBe(5)
    expect(deleteResponse.status).toBe(200)
    expect(deleteBody.success).toBe(true)
    expect(scheduleService.deleteJob).toHaveBeenCalledWith(42, 7)
  })

  it('rejects non-positive run list limits', async () => {
    const response = await app.request('/repos/42/schedules/7/runs?limit=0')
    const body = await response.json() as { error: string }

    expect(response.status).toBe(400)
    expect(body.error).toBe('Limit must be greater than 0')
    expect(scheduleService.listRuns).not.toHaveBeenCalled()
  })

  it('clamps large run list limits', async () => {
    scheduleService.listRuns.mockReturnValue([])

    const response = await app.request('/repos/42/schedules/7/runs?limit=500')

    expect(response.status).toBe(200)
    expect(scheduleService.listRuns).toHaveBeenCalledWith(42, 7, 100)
  })

  it('returns 404 when schedule job is not found', async () => {
    scheduleService.getJob.mockReturnValue(null)

    const response = await app.request('/repos/42/schedules/7')
    const body = await response.json() as { error: string }

    expect(response.status).toBe(404)
    expect(body.error).toBe('Schedule not found')
  })

  it('creates a cron schedule from a valid request body', async () => {
    scheduleService.createJob.mockReturnValue({ id: 8, name: 'Morning report' })

    const response = await app.request('/repos/42/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Morning report',
        enabled: true,
        scheduleMode: 'cron',
        cronExpression: '0 9 * * *',
        timezone: 'America/New_York',
        prompt: 'Generate the daily report.',
      }),
    })
    const body = await response.json() as { job: { id: number } }

    expect(response.status).toBe(201)
    expect(body.job.id).toBe(8)
    expect(scheduleService.createJob).toHaveBeenCalledWith(42, expect.objectContaining({
      scheduleMode: 'cron',
      cronExpression: '0 9 * * *',
      timezone: 'America/New_York',
    }))
  })

  it('lists all schedules across all repos', async () => {
    scheduleService.listAllJobsWithRepos.mockReturnValue([
      { id: 1, name: 'Job 1', repoName: 'Repo A', repoPath: '/path/a', repoUrl: 'https://repo-a' },
      { id: 2, name: 'Job 2', repoName: 'Repo B', repoPath: '/path/b', repoUrl: 'https://repo-b' },
    ])

    const response = await app.request('/repos/42/schedules/all')
    const body = await response.json() as { jobs: Array<{ id: number; name: string; repoName: string }> }

    expect(response.status).toBe(200)
    expect(body.jobs).toHaveLength(2)
    expect(body.jobs[0]).toEqual(expect.objectContaining({
      id: 1,
      name: 'Job 1',
      repoName: 'Repo A',
    }))
    expect(scheduleService.listAllJobsWithRepos).toHaveBeenCalled()
  })

  it('lists all runs with no filters', async () => {
    scheduleService.listAllRuns.mockReturnValue([
      { id: 1, jobId: 7, repoId: 42, status: 'completed', jobName: 'Test', repoName: 'repo', repoPath: '/repo' },
    ])

    const response = await app.request('/repos/42/schedules/all/runs')
    const body = await response.json() as { runs: Array<{ id: number }> }

    expect(response.status).toBe(200)
    expect(body.runs).toHaveLength(1)
    expect(scheduleService.listAllRuns).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, offset: 0 }))
  })

  it('passes query params to service for all runs', async () => {
    scheduleService.listAllRuns.mockReturnValue([])

    const response = await app.request('/repos/42/schedules/all/runs?limit=10&offset=5&status=failed&repoId=42&jobId=7&triggerSource=manual')
    const body = await response.json() as { runs: Array<unknown> }

    expect(response.status).toBe(200)
    expect(body.runs).toHaveLength(0)
    expect(scheduleService.listAllRuns).toHaveBeenCalledWith({
      limit: 10,
      offset: 5,
      status: 'failed',
      repoId: 42,
      jobId: 7,
      triggerSource: 'manual',
    })
  })
})

/**
 * Repository ownership on the per-repo schedule routes.
 *
 * These handlers take a repository id straight out of the URL and never used to
 * ask whether the caller may act on it, on either mount. The repository list is
 * what hides another tenant's ids, so anyone who learned one - from a log, a
 * run id, a teammate - could create, run, edit and delete that repository's
 * scheduled jobs.
 *
 * Each case therefore comes in a pair: what the other tenant must not reach,
 * and what its own tenant still can. A suite made only of refusals would pass
 * just as well against a route that 403s everything, which is the failure that
 * looks like a working product right up until someone tries to use it.
 */
describe('Schedule Routes - repository ownership', () => {
  let db: Database
  let alice: Hono
  let bob: Hono
  let admin: Hono
  let anonymous: Hono

  const addRepo = (id: number, userId: string | null) => {
    db.prepare(
      `INSERT INTO repos (id, local_path, default_branch, clone_status, cloned_at, user_id)
       VALUES (?, ?, 'main', 'ready', ?, ?)`,
    ).run(id, `repo-${id}`, Date.now(), userId)
  }

  const mount = (user: { id: string; role: 'admin' | 'user' } | null) => {
    const wrapper = new Hono()
    if (user) {
      wrapper.use('*', async (c, next) => {
        asUser(c, user)
        await next()
      })
    }
    wrapper.route(
      '/repos/:id/schedules',
      createScheduleRoutes(scheduleService as unknown as import('../../src/services/schedules').ScheduleService, db),
    )
    return wrapper
  }

  beforeEach(() => {
    vi.clearAllMocks()
    db = new Database(':memory:')
    migrate(db, allMigrations)
    addRepo(11, 'u-alice')
    addRepo(22, 'u-bob')
    addRepo(33, null)
    alice = mount({ id: 'u-alice', role: 'user' })
    bob = mount({ id: 'u-bob', role: 'user' })
    admin = mount({ id: 'u-root', role: 'admin' })
    anonymous = mount(null)
  })

  afterEach(() => {
    db.close()
  })

  it('still lists a tenant own repository schedules', async () => {
    scheduleService.listJobs.mockReturnValue([{ id: 7, name: 'Nightly' }])

    const response = await alice.request('/repos/11/schedules')

    expect(response.status).toBe(200)
    expect(scheduleService.listJobs).toHaveBeenCalledWith(11)
  })

  it('still shows a shared repository to a tenant that does not own it', async () => {
    // repos.user_id IS NULL means "shared", and that is the rule the repository
    // list already follows. Ownership checks must not quietly redefine it as
    // "owned by nobody".
    scheduleService.listJobs.mockReturnValue([])

    const response = await alice.request('/repos/33/schedules')

    expect(response.status).toBe(200)
  })

  it('refuses to read another tenant repository schedules', async () => {
    const response = await alice.request('/repos/22/schedules')

    expect(response.status).toBe(403)
    expect(scheduleService.listJobs).not.toHaveBeenCalled()
  })

  it('refuses to create a job on another tenant repository', async () => {
    const response = await alice.request('/repos/22/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Mine now', scheduleMode: 'interval', prompt: 'go' }),
    })

    expect(response.status).toBe(403)
    expect(scheduleService.createJob).not.toHaveBeenCalled()
  })

  it('refuses to run another tenant repository job', async () => {
    const response = await alice.request('/repos/22/schedules/7/run', { method: 'POST' })

    expect(response.status).toBe(403)
    expect(scheduleService.runJob).not.toHaveBeenCalled()
  })

  it('refuses to edit another tenant repository job', async () => {
    const response = await alice.request('/repos/22/schedules/7', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    })

    expect(response.status).toBe(403)
    expect(scheduleService.updateJob).not.toHaveBeenCalled()
  })

  it('refuses to delete another tenant repository job', async () => {
    const response = await alice.request('/repos/22/schedules/7', { method: 'DELETE' })

    expect(response.status).toBe(403)
    expect(scheduleService.deleteJob).not.toHaveBeenCalled()
  })

  it('refuses to read another tenant repository run history', async () => {
    const response = await alice.request('/repos/22/schedules/7/runs')

    expect(response.status).toBe(403)
    expect(scheduleService.listRuns).not.toHaveBeenCalled()
  })

  it('refuses to cancel another tenant repository run', async () => {
    const response = await alice.request('/repos/22/schedules/7/runs/5/cancel', { method: 'POST' })

    expect(response.status).toBe(403)
    expect(scheduleService.cancelRun).not.toHaveBeenCalled()
  })

  it('refuses to clear another tenant repository run history', async () => {
    const response = await alice.request('/repos/22/schedules/7/runs', { method: 'DELETE' })

    expect(response.status).toBe(403)
    expect(scheduleService.clearRunHistory).not.toHaveBeenCalled()
  })

  it('refuses to delete a single run of another tenant repository', async () => {
    const response = await alice.request('/repos/22/schedules/7/runs/5', { method: 'DELETE' })

    expect(response.status).toBe(403)
    expect(scheduleService.deleteRun).not.toHaveBeenCalled()
  })

  it('refuses to fetch one job of another tenant repository', async () => {
    const response = await alice.request('/repos/22/schedules/7')

    expect(response.status).toBe(403)
    expect(scheduleService.getJob).not.toHaveBeenCalled()
  })

  it('works the same way in the other direction', async () => {
    // One direction is enough for a rule, two is enough to catch a guard that
    // was written against a hard-coded id.
    const response = await bob.request('/repos/11/schedules')
    expect(response.status).toBe(403)
  })

  it('lets an administrator drive any repository', async () => {
    scheduleService.listJobs.mockReturnValue([])

    const response = await admin.request('/repos/22/schedules')

    expect(response.status).toBe(200)
  })

  it('refuses a request with no subject at all', async () => {
    // Both mounts now guarantee one, so this cannot happen in the product. It
    // is the case that used to return every schedule, and it is the one that
    // must never come back.
    expect((await anonymous.request('/repos/22/schedules')).status).toBe(401)
    expect((await anonymous.request('/repos/22/schedules/7/run', { method: 'POST' })).status).toBe(401)
    expect((await anonymous.request('/repos/22/schedules/all')).status).toBe(401)
    expect((await anonymous.request('/repos/22/schedules/all/runs')).status).toBe(401)
  })

  it('narrows the cross-repository list to what the caller may see', async () => {
    scheduleService.listAllJobsWithRepos.mockReturnValue([
      { id: 1, repoId: 11, name: 'alice job' },
      { id: 2, repoId: 22, name: 'bob job' },
      { id: 3, repoId: 33, name: 'shared job' },
    ])

    const response = await alice.request('/repos/11/schedules/all')
    const body = await response.json() as { jobs: { id: number }[] }

    expect(body.jobs.map((j) => j.id).sort()).toEqual([1, 3])
  })

  it('narrows the cross-repository run list to what the caller may see', async () => {
    // A run row carries the session id the agent ran in. Handing one tenant
    // every row would hand them the session ids the identity scheme is built
    // on - the value they would then present to be placed as that tenant.
    scheduleService.listAllRuns.mockReturnValue([
      { id: 1, repoId: 11, sessionId: 'ses_alice' },
      { id: 2, repoId: 22, sessionId: 'ses_bob' },
    ])

    const response = await alice.request('/repos/11/schedules/all/runs')
    const body = await response.json() as { runs: { sessionId: string | null }[] }

    expect(body.runs.map((r) => r.sessionId)).toEqual(['ses_alice'])
  })

  it('leaves the cross-repository lists untouched for an administrator', async () => {
    scheduleService.listAllJobsWithRepos.mockReturnValue([
      { id: 1, repoId: 11 },
      { id: 2, repoId: 22 },
    ])

    const response = await admin.request('/repos/11/schedules/all')
    const body = await response.json() as { jobs: unknown[] }

    expect(body.jobs).toHaveLength(2)
  })
})
