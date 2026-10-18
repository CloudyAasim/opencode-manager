import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { Database } from 'bun:sqlite'
import { getRepoById, getRepoName } from '../../db/queries'
import { canAccessRepo } from '../../auth/ownership'
import { internalUserOf } from '../../auth/internal-token-middleware'
import { logger } from '../../utils/logger'
import { getErrorMessage } from '../../utils/error-utils'
import { safeGitOut } from '../../services/git/git-commands'

export function createInternalRepoSyncRoutes(db: Database) {
  const app = new Hono()

  /**
   * The same gap the mirror routes had: the row's owner is recorded, but
   * `getRepoById` does not filter by it and nothing between the token
   * middleware and the handler checked. Repository ids are small sequential
   * integers.
   *
   * What it hands over is not only a name and a branch - `originUrl` is
   * `git remote get-url origin`, which is whatever the repository was cloned
   * with. A repository cloned from `https://user:token@host/...` still has
   * that in its config, so this endpoint can return a credential.
   */
  const repoOwnershipGuard: MiddlewareHandler = async (c, next) => {
    const raw = c.req.param('repoId')
    const id = Number(raw)
    if (!raw || !Number.isFinite(id)) {
      await next()
      return
    }
    const principal = internalUserOf(c)
    if (principal && canAccessRepo(db, id, principal)) {
      await next()
      return
    }
    // 404 for both "absent" and "not yours", so the status is not an oracle
    // for which repositories exist.
    return c.json({ error: 'Repository not found' }, 404)
  }

  app.use('/:repoId/*', repoOwnershipGuard)

  app.get('/:repoId/git-info', async (c) => {
    const repoIdRaw = c.req.param('repoId')
    const repoId = Number(repoIdRaw)
    if (!Number.isFinite(repoId)) return c.json({ error: 'invalid repoId' }, 400)
    const repo = getRepoById(db, repoId)
    if (!repo) return c.json({ error: 'repo not found' }, 404)
    if (repo.cloneStatus !== 'ready') return c.json({ error: 'repo not ready' }, 409)
    const repoPath = repo.fullPath
    try {
      const [originUrl, head, branch, status] = await Promise.all([
        safeGitOut(repoPath, ['remote', 'get-url', 'origin']),
        safeGitOut(repoPath, ['rev-parse', 'HEAD']),
        safeGitOut(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
        safeGitOut(repoPath, ['status', '--porcelain']),
      ])
      return c.json({
        repoId,
        repoName: getRepoName(repo),
        directory: repoPath,
        originUrl: originUrl?.trim() || null,
        head: head?.trim() || null,
        branch: branch?.trim() || null,
        dirty: Boolean(status && status.trim().length > 0),
      })
    } catch (error) {
      logger.error('git-info failed:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  return app
}
