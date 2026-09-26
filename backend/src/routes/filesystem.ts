import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import * as filesystemService from '../services/filesystem'
import { logger } from '../utils/logger'
import { getErrorMessage, getStatusCode } from '../utils/error-utils'
import { getAccessScope } from '../auth/access-scope'
import type { Session } from '../auth'

export function createFilesystemRoutes() {
  const app = new Hono<{ Variables: { session: Session['session']; user: Session['user'] } }>()

  app.get('/browse', async (c) => {
    try {
      const requestedPath = c.req.query('path')
      const browseRoot = getAccessScope()?.browseRoot
      if (!browseRoot) {
        return c.json({ error: 'No workspace root is available for this account' }, 403)
      }
      const result = await filesystemService.browseDirectory(requestedPath, browseRoot)
      return c.json(result)
    } catch (error: unknown) {
      logger.error('Failed to browse directory:', error)
      return c.json({ error: getErrorMessage(error) || 'Failed to browse directory' }, getStatusCode(error) as ContentfulStatusCode)
    }
  })

  return app
}
