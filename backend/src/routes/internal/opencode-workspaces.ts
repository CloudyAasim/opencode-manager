import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { getRepoName, listRepos } from '../../db/queries'
import { internalUserOf } from '../../auth/internal-token-middleware'
import { accessibleRepoIds, principalFrom } from '../../auth/ownership'
import { resolveProjectId } from '../../services/project-id-resolver'
import { logger } from '../../utils/logger'
import { getErrorMessage } from '../../utils/error-utils'

export function createInternalOpenCodeWorkspacesRoutes(db: Database) {
  const app = new Hono()

  app.get('/', async (c) => {
    try {
      const principal = principalFrom(internalUserOf(c))
      // Same reasoning as the repo list, and the same change: an unplaceable
      // caller is refused rather than shown every workspace in the building.
      if (!principal) return c.json({ error: 'Unauthorized' }, 401)
      const allowed = new Set(accessibleRepoIds(db, principal))
      const repos = listRepos(db)
        .filter((repo) => repo.cloneStatus === 'ready')
        .filter((repo) => allowed.has(repo.id))
      const workspaces = await Promise.all(
        repos.map(async (repo) => ({
          repoId: repo.id,
          name: getRepoName(repo),
          branch: repo.branch ?? null,
          cloneStatus: repo.cloneStatus,
          directory: repo.fullPath,
          originUrl: repo.repoUrl ?? null,
          projectId: await resolveProjectId(repo.fullPath).catch(() => null),
          isWorktree: repo.isWorktree === true,
          extra: {
            repoId: repo.id,
            localPath: repo.localPath,
            fullPath: repo.fullPath,
          },
        })),
      )
      return c.json({ workspaces })
    } catch (error) {
      logger.error('Failed to list opencode workspaces:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  return app
}
