import { Hono } from 'hono'
import { ManagerLogQuerySchema } from '@opencode-manager/shared/schemas'
import { readManagerLogEntries } from '../utils/log-buffer'
import { requireAdmin } from '../auth/middleware'

export function createLogRoutes() {
  const app = new Hono()

  // The buffer is one per process, not one per account: it records what the
  // server is doing, which includes every tenant's sign-in results, every
  // account creation with the email and role that was assigned, and absolute
  // paths under the workspace. Any logged-in user could read all of it, and
  // watch another account's authentication attempts arrive.
  //
  // There is no per-tenant view to offer instead - these are the operator's
  // diagnostics about the process itself - so this is admin-only, the same
  // shape as `opencode-config`.
  app.use('/*', requireAdmin)

  app.get('/', (c) => {
    const result = ManagerLogQuerySchema.safeParse(c.req.query())
    if (!result.success) {
      return c.json({ error: 'Invalid request', details: result.error.issues }, 400)
    }
    return c.json(readManagerLogEntries(result.data))
  })

  return app
}
