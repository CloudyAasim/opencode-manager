import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { Database } from 'bun:sqlite'
import type { ScheduleService } from '../../services/schedules'
import type { NotificationService } from '../../services/notification'
import type { SettingsService } from '../../services/settings'
import type { OpenCodeClient } from '../../services/opencode/client'
import { createScheduleRoutes } from '../schedules'
import { createInternalTokenMiddleware, internalUserOf } from '../../auth/internal-token-middleware'
import { canAccessRepo, principalFrom } from '../../auth/ownership'
import { createInternalNotificationRoutes } from './notifications'
import { createInternalSettingsRoutes } from './settings'
import { createOpenCodeConfigRoutes } from '../opencode-config'
import { createInternalRepoRoutes } from './repos'
import { createInternalRepoSyncRoutes } from './repo-sync'
import { createInternalRepoMirrorRoutes as mirrorRoutes } from './repo-mirror'
import { createInternalOpenCodeWorkspacesRoutes } from './opencode-workspaces'
import { createInternalAssistantRoutes } from './assistant'
import { createInternalGitCredentialsRoutes } from './git-credentials'

/**
 * The per-repo schedule routes create, run, edit and delete jobs by repo id,
 * and they never checked who was asking - on any path. Here, where a placed
 * request has an owner, that is a cross-tenant write: trigger or delete
 * somebody else's schedule.
 *
 * Mounted here rather than inside `createScheduleRoutes` on purpose. That
 * factory is shared with the web API, where the user comes from a signed-in
 * session, and changing what the web API accepts is not this stage's business.
 *
 * An unplaced request is let through untouched, for the same reason every other
 * narrowing here is: refusing is the next stage, and doing it now would break
 * the sessions that have no recorded owner.
 */
function createRepoOwnershipGuard(db: Database) {
  return createMiddleware(async (c, next) => {
    const principal = principalFrom(internalUserOf(c))
    if (!principal) return next()

    const repoId = Number(c.req.param('id'))
    if (!Number.isFinite(repoId)) return next()
    if (!canAccessRepo(db, repoId, principal)) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    return next()
  })
}

export function createInternalRoutes(
  db: Database,
  scheduleService: ScheduleService,
  notificationService: NotificationService,
  settingsService: SettingsService,
  openCodeClient: OpenCodeClient,
) {
  const app = new Hono()
  app.use('/*', createInternalTokenMiddleware(db))
  app.route('/schedules', createScheduleRoutes(scheduleService, db))
  app.route('/notifications', createInternalNotificationRoutes(notificationService))
  app.route('/settings', createInternalSettingsRoutes(settingsService))
  app.route('/opencode-config', createOpenCodeConfigRoutes(settingsService, openCodeClient))
  const repos = new Hono()
  repos.route('/', createInternalRepoRoutes(db, settingsService))
  repos.use('/:id/schedules/*', createRepoOwnershipGuard(db))
  repos.route('/:id/schedules', createScheduleRoutes(scheduleService, db))
  repos.route('/', createInternalRepoSyncRoutes(db))
  repos.route('/', mirrorRoutes(db))
  app.route('/repos', repos)
  app.route('/opencode-workspaces', createInternalOpenCodeWorkspacesRoutes(db))
  app.route('/assistant', createInternalAssistantRoutes(openCodeClient))
  app.route('/git-credentials', createInternalGitCredentialsRoutes(db))
  return app
}
