import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Database } from 'bun:sqlite'
import { z } from 'zod'
import { UpdateOpenCodeConfigRequestSchema } from '@opencode-manager/shared/schemas'
import type { SettingsService } from '../services/settings'
import { UpstreamError, type OpenCodeClient } from '../services/opencode/client'
import { requireAdmin } from '../auth/middleware'
import type { Session } from '../auth'
import { getTrustedClientIp } from '../utils/client-ip'
import {
  OpenCodeConfigConflictError,
  OpenCodeConfigShadowedRemovalError,
  OpenCodeConfigSourceInvalidError,
  readOpenCodeConfigFile,
  withOpenCodeConfigLock,
} from '../services/opencode-config-file'
import { applyOpenCodeConfigUpdate, toOpenCodeConfigApplyResponse } from '../services/opencode-config-apply'
import type { OpenCodeConfigAuditActor } from '../services/opencode-config-audit'
import { logger } from '../utils/logger'

type OpenCodeConfigContext = Context<{
  Variables: {
    session: Session['session']
    user: Session['user']
  }
}>

/**
 * Who is making this call, for the audit row.
 *
 * Read defensively on purpose. This route is mounted twice - under the web API
 * and under the internal one - and the two put different things on the context:
 * a full session user, or the `{ id, role, username }` the token middleware
 * resolved a request to. The second has no email, and reading it as if it did
 * would put the word "undefined" in the audit log rather than admitting there
 * is none.
 */
function actorFrom(c: OpenCodeConfigContext): OpenCodeConfigAuditActor {
  const user = c.get('user') as { id?: string; email?: string | null } | undefined
  return {
    userId: user?.id ?? null,
    userEmail: user?.email ?? null,
    ipAddress: getTrustedClientIp(c.req.raw.headers),
    userAgent: c.req.header('user-agent') ?? null,
  }
}

export function createOpenCodeConfigRoutes(
  settingsService: SettingsService,
  openCodeClient: OpenCodeClient,
  db: Database,
) {
  const app = new Hono<{
    Variables: {
      session: Session['session']
      user: Session['user']
    }
  }>()

  // There is one OpenCode configuration for the whole server: every tenant's
  // sessions read it. A write here is therefore not the caller's own business
  // but everyone's, so it is admin-only - and the check belongs here, on the
  // factory, rather than on one of the two mounts. The internal mount reaches
  // the same file with a user token or the agent plugin, so guarding only the
  // web path would have left the same edit one URL away for anyone holding
  // either. Both mounts set `user` before this runs, so one check covers them.
  app.use('/*', requireAdmin)

  app.get('/', async (c) => {
    try {
      const config = await withOpenCodeConfigLock(readOpenCodeConfigFile)
      if (!config) {
        return c.json({ error: 'No OpenCode config file found' }, 404)
      }
      return c.json(config)
    } catch (error) {
      logger.error('Failed to get OpenCode config:', error)
      return c.json({ error: 'Failed to get OpenCode config' }, 500)
    }
  })

  app.get('/effective', async (c) => {
    try {
      const config = await openCodeClient.getJson<Record<string, unknown>>('/global/config')
      return c.json(config)
    } catch (error) {
      logger.error('Failed to get effective OpenCode config:', error)
      if (error instanceof UpstreamError) {
        if (error.status === 502) {
          return c.json({ error: 'OpenCode server unavailable' }, 503)
        }
        return c.json({ error: 'Failed to get effective OpenCode config' }, 502)
      }
      return c.json({ error: 'Failed to get effective OpenCode config' }, 500)
    }
  })

  app.put('/', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    const parsed = UpdateOpenCodeConfigRequestSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid config data', details: parsed.error.issues }, 400)
    }

    try {
      const result = await applyOpenCodeConfigUpdate({
        content: parsed.data.content,
        source: parsed.data.source,
        expectedRevision: parsed.data.expectedRevision,
        settingsService,
        db,
        actor: actorFrom(c as OpenCodeConfigContext),
      })
      const { status, body: responseBody } = toOpenCodeConfigApplyResponse(result)
      return c.json(responseBody, status)
    } catch (error) {
      logger.error('Failed to update OpenCode config:', error)
      if (error instanceof OpenCodeConfigConflictError) {
        return c.json({
          error: error.message,
          expectedRevision: error.expectedRevision,
          actualRevision: error.actualRevision,
        }, 409)
      }
      if (error instanceof OpenCodeConfigSourceInvalidError) {
        return c.json({ error: error.message, sources: error.sources }, 400)
      }
      if (error instanceof OpenCodeConfigShadowedRemovalError) {
        return c.json({ error: error.message, paths: error.paths, sources: error.sources }, 409)
      }
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid config data', details: error.issues }, 400)
      }
      if (error instanceof SyntaxError) {
        return c.json({ error: 'Invalid config data', details: error.message }, 400)
      }
      return c.json({ error: 'Failed to update OpenCode config' }, 500)
    }
  })

  return app
}
