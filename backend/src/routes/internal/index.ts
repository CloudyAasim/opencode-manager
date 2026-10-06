import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import type { ScheduleService } from '../../services/schedules'
import type { NotificationService } from '../../services/notification'
import type { SettingsService } from '../../services/settings'
import type { OpenCodeClient } from '../../services/opencode/client'
import { createScheduleRoutes } from '../schedules'
import { createInternalTokenMiddleware } from '../../auth/internal-token-middleware'
import { createInternalNotificationRoutes } from './notifications'
import { createInternalSettingsRoutes } from './settings'
import { createOpenCodeConfigRoutes } from '../opencode-config'
import { createInternalRepoRoutes } from './repos'
import { createInternalRepoSyncRoutes } from './repo-sync'
import { createInternalRepoMirrorRoutes as mirrorRoutes } from './repo-mirror'
import { createInternalOpenCodeWorkspacesRoutes } from './opencode-workspaces'
import { createInternalAssistantRoutes } from './assistant'
import { createInternalGitCredentialsRoutes } from './git-credentials'

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
  // One OpenCode configuration for the whole server, so there is no per-tenant
  // copy of it to scope anything to and no rule here that could tell two
  // tenants apart - which is why this route is admin-only rather than
  // filtered. The check lives in the route factory, where the web mount gets
  // it too, because the point of it is that there is nowhere else to reach this
  // file from: a user token or the agent plugin would otherwise be one URL away
  // from the edit the web page just refused. What the token middleware still
  // buys is who is asking - a shared token alone no longer gets in, so "any
  // tenant's agent rewrites everyone's config" is not something a copied token
  // can do either.
  app.route('/opencode-config', createOpenCodeConfigRoutes(settingsService, openCodeClient, db))
  const repos = new Hono()
  repos.route('/', createInternalRepoRoutes(db, settingsService))
  // The per-repo schedule routes carry their own ownership check now, the same
  // one the web API uses. A second guard here would be the same rule written
  // twice, and the two would be free to disagree.
  repos.route('/:id/schedules', createScheduleRoutes(scheduleService, db))
  repos.route('/', createInternalRepoSyncRoutes(db))
  repos.route('/', mirrorRoutes(db))
  app.route('/repos', repos)
  app.route('/opencode-workspaces', createInternalOpenCodeWorkspacesRoutes(db))
  app.route('/assistant', createInternalAssistantRoutes(openCodeClient))
  app.route('/git-credentials', createInternalGitCredentialsRoutes(db))
  return app
}
