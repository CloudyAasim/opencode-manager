import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { createInternalRepoRoutes } from '../../src/routes/internal/repos'
import { createInternalOpenCodeWorkspacesRoutes } from '../../src/routes/internal/opencode-workspaces'
import { createInternalSettingsRoutes } from '../../src/routes/internal/settings'
import { SettingsService } from '../../src/services/settings'
import { listRepos } from '../../src/db/queries'
import { allMigrations } from '../../src/db/migrations'
import { migrate } from '../../src/db/migration-runner'

/**
 * The three routes that used to fall back to "everything" when they could not
 * tell who was asking.
 *
 * They are mounted here with **no middleware in front of them**, which is the
 * only way these guards are observable at all. Behind the internal token
 * middleware the question never arises: an unplaceable request is refused
 * before it arrives, so a test that only goes through the full stack passes
 * whether the guard is present or not. That is not a theoretical worry - it is
 * what mutation testing found: deleting all three guards changed no test.
 *
 * So these cases bypass the middleware deliberately. The point is not that the
 * product can reach this state - it cannot - but that a route which hands over
 * an entire tenant's data on the strength of "I could not work out who this is"
 * should not exist, even if the thing in front of it is later changed.
 */
describe('internal routes refuse rather than fall back when they have no subject', () => {
  let db: Database
  let settingsService: SettingsService

  /** Written out rather than going through `createRepo`, because the id has to
   *  be explicit - the assertions below are about specific repositories. */
  const addRepo = (id: number, localPath: string, userId: string | null): void => {
    db.prepare(
      `INSERT INTO repos (id, local_path, default_branch, clone_status, cloned_at, user_id)
       VALUES (?, ?, 'main', 'ready', ?, ?)`,
    ).run(id, localPath, Date.now(), userId)
  }

  /** The route on its own - no `createInternalTokenMiddleware`, by design. */
  const bare = (route: Hono): Hono => {
    const app = new Hono()
    app.route('/', route)
    return app
  }

  const asUser = (user: { id: string; role: 'admin' | 'user' } | null, route: Hono): Hono => {
    const app = new Hono()
    if (user) {
      app.use('*', async (c, next) => {
        (c as unknown as { set: (key: string, value: unknown) => void })
          .set('user', { ...user, username: user.id })
        await next()
      })
    }
    app.route('/', route)
    return app
  }

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    settingsService = new SettingsService(db)
    addRepo(11, 'alice-project', 'u-alice')
    addRepo(22, 'bob-project', 'u-bob')
    addRepo(33, 'shared-project', null)
  })

  // --- GET /repos ---------------------------------------------------------

  it('does not serve the repository list to a caller with no subject', async () => {
    const res = await bare(createInternalRepoRoutes(db, settingsService)).request('/')

    expect(res.status).toBe(401)
  })

  it('still serves a tenant their own repository list', async () => {
    // The refusal is not a way to make the route return nothing. A caller with
    // a subject must get exactly what they are entitled to.
    const res = await asUser({ id: 'u-alice', role: 'user' }, createInternalRepoRoutes(db, settingsService)).request('/')

    expect(res.status).toBe(200)
    const body = await res.json() as { repos: { id: number }[] }
    expect(body.repos.map((r) => r.id).sort()).toEqual([11, 33])
  })

  it('does not narrow an administrator either - a subject is still required', async () => {
    // Not "admins are exempt": an admin *is* a subject, and this is the shape
    // of the request. A branch that special-cased the role here would be a new
    // way in.
    const res = await asUser({ id: 'u-root', role: 'admin' }, createInternalRepoRoutes(db, settingsService)).request('/')

    expect(res.status).toBe(200)
  })

  // --- GET /opencode-workspaces -------------------------------------------

  it('does not serve the workspace list to a caller with no subject', async () => {
    const res = await bare(createInternalOpenCodeWorkspacesRoutes(db)).request('/')

    expect(res.status).toBe(401)
  })

  it('still serves a tenant their own workspaces', async () => {
    const res = await asUser({ id: 'u-bob', role: 'user' }, createInternalOpenCodeWorkspacesRoutes(db)).request('/')

    expect(res.status).toBe(200)
    const body = await res.json() as { workspaces: { repoId: number }[] }
    expect(body.workspaces.map((w) => w.repoId)).toEqual([22, 33])
  })

  // --- GET/PATCH /settings ------------------------------------------------

  it('does not serve settings to a caller with no subject', async () => {
    const res = await bare(createInternalSettingsRoutes(settingsService)).request('/')

    expect(res.status).toBe(401)
  })

  it('does not fall back to ?userId= for a caller with no subject', async () => {
    // The selector stage 2 removed. Keeping it as a fallback would have left
    // the original hole open behind a middleware that happens to be installed,
    // and a stored set can hold TTS and STT API keys.
    settingsService.updateSettings({ theme: 'dark' }, 'u-bob')

    const res = await bare(createInternalSettingsRoutes(settingsService)).request('/?userId=u-bob')

    expect(res.status).toBe(401)
  })

  it('does not write settings on behalf of a named user for a caller with no subject', async () => {
    const res = await bare(createInternalSettingsRoutes(settingsService)).request('/', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme: 'dark' }),
    })

    expect(res.status).toBe(401)
    expect(settingsService.getSettings('u-bob').preferences.theme).not.toBe('dark')
  })

  it('still reads and writes only the caller own settings', async () => {
    settingsService.updateSettings({ theme: 'dark' }, 'u-bob')
    const app = asUser({ id: 'u-alice', role: 'user' }, createInternalSettingsRoutes(settingsService))

    const res = await app.request('/?userId=u-bob')
    expect(res.status).toBe(200)
    const body = await res.json() as { preferences: { theme?: string } }
    expect(body.preferences.theme).not.toBe('dark')
  })

  // --- the list the guards are protecting ---------------------------------

  it('is guarding something: there are repositories to leak', async () => {
    // If this ever stops holding, the three refusals above are refusing to
    // protect nothing, and the suite would still be green.
    expect(listRepos(db).length).toBe(3)
  })
})
