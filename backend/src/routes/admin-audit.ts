import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import { requireAdmin } from '../auth/middleware'
import type { Session } from '../auth'
import { listTerminalAudit, pruneTerminalAudit } from '../services/terminal/audit'
import { logger } from '../utils/logger'
import { getErrorMessage } from '../utils/error-utils'

const querySchema = z.object({
  userId: z.string().min(1).max(200).optional(),
  email: z.string().min(1).max(320).optional(),
  active: z.enum(['true', 'false']).optional(),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

const pruneSchema = z.object({
  before: z.number().int().positive(),
})

type AuditContext = Context<{
  Variables: {
    session: Session['session']
    user: Session['user']
  }
}>

function handleError(c: AuditContext, error: unknown) {
  if (error instanceof z.ZodError) {
    return c.json({ error: 'Invalid request', details: error.issues }, 400)
  }
  logger.error('Audit route error', error)
  return c.json({ error: getErrorMessage(error) }, 500)
}

export function createAuditRoutes(db: Database) {
  const app = new Hono<{
    Variables: {
      session: Session['session']
      user: Session['user']
    }
  }>()

  app.use('/*', requireAdmin)

  app.get('/terminal', (c) => {
    try {
      const query = querySchema.parse(c.req.query())
      const result = listTerminalAudit(db, {
        userId: query.userId,
        email: query.email,
        active: query.active === undefined ? undefined : query.active === 'true',
        from: query.from,
        to: query.to,
        limit: query.limit,
        offset: query.offset,
      })
      return c.json(result)
    } catch (error) {
      return handleError(c, error)
    }
  })

  app.post('/terminal/prune', async (c) => {
    try {
      const input = pruneSchema.parse(await c.req.json())
      const deleted = pruneTerminalAudit(db, input.before)
      logger.info(`Pruned ${deleted} terminal audit rows`)
      return c.json({ deleted })
    } catch (error) {
      return handleError(c, error)
    }
  })

  return app
}
