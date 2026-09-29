import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import type { OpenCodeClient } from '../services/opencode/client'
import type { OpenCodeSupervisor } from '../services/opencode-supervisor'
import type { GitAuthService } from '../services/git-auth'
import { createSettingsRouteContext } from './settings/context'
import { createPreferencesRoutes } from './settings/preferences'
import { createOpenCodeLifecycleRoutes } from './settings/opencode-lifecycle'
import { createConfigEditorRoutes } from './settings/config-editor'
import { createSkillsRoutes } from './settings/skills'
import { createCredentialsRoutes } from './settings/credentials'
import { createSystemRoutes } from './settings/system'

export function createSettingsRoutes(
  db: Database,
  gitAuthService: GitAuthService,
  openCodeClient: OpenCodeClient,
  openCodeSupervisor?: OpenCodeSupervisor,
) {
  const app = new Hono()
  const ctx = createSettingsRouteContext(db, gitAuthService, openCodeClient, openCodeSupervisor)

  app.route('/', createPreferencesRoutes(ctx))
  app.route('/', createOpenCodeLifecycleRoutes(ctx))
  app.route('/', createConfigEditorRoutes(ctx))
  app.route('/', createSkillsRoutes(ctx))
  app.route('/', createCredentialsRoutes(ctx))
  app.route('/', createSystemRoutes(ctx))

  return app
}
