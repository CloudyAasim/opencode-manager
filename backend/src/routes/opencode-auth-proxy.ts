import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { Database } from 'bun:sqlite'
import { opencodeServerManager } from '../services/opencode-single-server'
import type { OpenCodeClient } from '../services/opencode/client'
import { getRepoByDirectory } from '../db/queries'
import { canAccessRepo, principalFrom, principalIsAdmin } from '../auth/ownership'
import type { Session } from '../auth'
import { logger } from '../utils/logger'

export function createAuthenticatedOpenCodeProxyRoutes(
  openCodeClient: OpenCodeClient,
  requireAuth: MiddlewareHandler,
  database: Database,
): Hono {
  const app = new Hono()

  app.all('/*', requireAuth, async (c) => {
    if (!opencodeServerManager.isLifecycleInitialized()) {
      return c.json({ error: 'OpenCode lifecycle initialization is incomplete; refusing to proxy to an unmanaged server' }, 503)
    }

    const directory = c.req.query('directory')
    if (directory) {
      const principal = principalFrom(
        (c as unknown as { get: (key: string) => Session['user'] | undefined }).get('user'),
      )
      if (principal && !principalIsAdmin(principal)) {
        const repo = getRepoByDirectory(database, directory)
        if (!repo || !canAccessRepo(database, repo.id, principal)) {
          logger.warn(`Blocked cross-tenant OpenCode proxy access to directory: ${directory}`)
          return c.json({ error: 'Forbidden' }, 403)
        }
      }
    }

    return openCodeClient.forwardRaw(c.req.raw)
  })

  return app
}
