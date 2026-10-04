import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { listRepos } from '../../db/queries'
import { internalUserOf } from '../../auth/internal-token-middleware'
import { accessibleRepoIds, principalFrom } from '../../auth/ownership'
import type { SettingsService } from '../../services/settings'
import { logger } from '../../utils/logger'
import { getErrorMessage } from '../../utils/error-utils'

export function createInternalRepoRoutes(db: Database, settingsService: SettingsService) {
  const app = new Hono()

  app.get('/', (c) => {
    try {
      const settings = settingsService.getSettings()
      const repos = listRepos(db, settings.preferences.repoOrder)
      const principal = principalFrom(internalUserOf(c))

      // This used to read "no placement, no narrowing" and serve the whole
      // list. The middleware no longer lets an unplaceable request this far,
      // so the branch is unreachable - and unreachable branches in an
      // authorisation path are how they come back. Refuse.
      if (!principal) return c.json({ error: 'Unauthorized' }, 401)

      // One query for the whole list rather than a lookup per repo: this runs
      // on every tool call an agent makes, and the repo list is not small.
      const allowed = new Set(accessibleRepoIds(db, principal))
      return c.json({ repos: repos.filter((repo) => allowed.has(repo.id)) })
    } catch (error) {
      logger.error('Failed to list internal repos:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  return app
}
