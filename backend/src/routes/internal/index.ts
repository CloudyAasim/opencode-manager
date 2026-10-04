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
  // copy of it to scope anything to. It is left unfiltered rather than given an
  // invented rule: the settings page has always let any signed-in user edit
  // this file, so restricting only this path would leave the same action one
  // click away where it matters more. What did change is who can reach here at
  // all - the shared token alone no longer gets in, so "any tenant's agent
  // rewrites everyone's config" is no longer something a copied token can do.
  app.route('/opencode-config', createOpenCodeConfigRoutes(settingsService, openCodeClient))
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
