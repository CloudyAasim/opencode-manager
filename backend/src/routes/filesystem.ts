import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import * as filesystemService from '../services/filesystem'
import { logger } from '../utils/logger'
import { getErrorMessage, getStatusCode } from '../utils/error-utils'
import { getAccessScope } from '../auth/access-scope'
import { principalFrom, resolveBrowseRoot } from '../auth/ownership'
import type { Session } from '../auth'

export function createFilesystemRoutes() {
  const app = new Hono<{ Variables: { session: Session['session']; user: Session['user'] } }>()

  app.get('/browse', async (c) => {
    try {
      const requestedPath = c.req.query('path')
      const scope = getAccessScope()
      const user = c.get('user')
      const root = scope?.browseRoot ?? resolveBrowseRoot(principalFrom(user))
      const result = await filesystemService.browseDirectory(requestedPath, root)
      return c.json(result)
    } catch (error: unknown) {
      logger.error('Failed to browse directory:', error)
      return c.json({ error: getErrorMessage(error) || 'Failed to browse directory' }, getStatusCode(error) as ContentfulStatusCode)
    }
  })

  return app
}
