import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { Database } from 'bun:sqlite'
import { opencodeServerManager } from '../services/opencode-single-server'
import type { OpenCodeClient } from '../services/opencode/client'
import { principalFrom, principalIsAdmin, resolveAccessRoots } from '../auth/ownership'
import { isWithinRoots } from '../auth/access-scope'
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
        const roots = resolveAccessRoots(database, principal)
        if (!isWithinRoots(directory, roots)) {
          logger.warn(`Blocked cross-tenant OpenCode proxy access to directory: ${directory}`)
          return c.json({ error: 'Forbidden' }, 403)
        }
      }
    }

    return openCodeClient.forwardRaw(c.req.raw)
  })

  return app
}
