import { Hono } from 'hono'
import { z } from 'zod'
import { logger } from '../../utils/logger'
import { discoverModelsCached } from '../../utils/discovery-cache'
import { getOrCreateUserToken, rotateUserToken } from '../../services/internal-token'
import { sseAggregator } from '../../services/sse-aggregator'
import { restartOpenCode, getOpenCodeRestartCoordinator } from '../../services/opencode-restart'
import { ENV } from '@opencode-manager/shared/config/env'
import type { SettingsRouteContext } from './context'
import { OpenCodeServerAuthBodySchema } from '@opencode-manager/shared/schemas'
import { principalIsAdmin, resolveAccessRoots } from '../../auth/ownership'
import { isWithinRoots } from '../../auth/access-scope'

export function createSystemRoutes(ctx: SettingsRouteContext) {
  const { db, openCodeSupervisor, settingsService, currentUserId, currentPrincipal } = ctx
  const app = new Hono()
  app.get('/opencode-server-auth', async (c) => {
    try {
      const hasStored = settingsService.hasStoredOpenCodeServerPassword()
      const source = hasStored ? 'db' : ENV.OPENCODE.SERVER_PASSWORD ? 'env' : 'none'
      const isSet = source !== 'none'
      return c.json({ isSet, source })
    } catch (error) {
      logger.error('Failed to get OpenCode server auth status:', error)
      return c.json({ error: 'Failed to get OpenCode server auth status' }, 500)
    }
  })

  app.patch('/opencode-server-auth', async (c) => {
    try {
      const body = await c.req.json()
      const validated = OpenCodeServerAuthBodySchema.parse(body)
      const previousPasswordState = settingsService.getStoredOpenCodeServerPasswordState()

      if (validated.password === null) {
        settingsService.clearOpenCodeServerPassword()
      } else if (validated.password) {
        settingsService.setOpenCodeServerPassword(validated.password)
      }

      try {
        await restartOpenCode(openCodeSupervisor)
      } catch (restartError) {
        try {
          settingsService.restoreOpenCodeServerPasswordState(previousPasswordState)
          await restartOpenCode(openCodeSupervisor)
          sseAggregator.reconnect()
        } catch (restoreError) {
          logger.error('Failed to restore OpenCode server auth runtime after restart failure:', restoreError)
        }
        throw restartError
      }

      sseAggregator.reconnect()

      const hasStored = settingsService.hasStoredOpenCodeServerPassword()
      const source = hasStored ? 'db' : ENV.OPENCODE.SERVER_PASSWORD ? 'env' : 'none'
      const isSet = source !== 'none'
      return c.json({ isSet, source })
    } catch (error) {
      logger.error('Failed to update OpenCode server auth:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update OpenCode server auth' }, 500)
    }
  })

  /**
   * The caller's own token, minted on first ask.
   *
   * This used to return one global token, the same one the OpenCode server
   * holds. That token cannot mean anything about a person - it is in the
   * environment of a process shared by every tenant - so handing it out from a
   * per-user settings page made every tenant a holder of every tenant's
   * credentials, and any of them could read the others' repositories and
   * session ids with a single request.
   */
  app.get('/manager-token', async (c) => {
    try {
      const token = getOrCreateUserToken(db, currentUserId(c))
      return c.json({ token })
    } catch (error) {
      logger.error('Failed to get manager token:', error)
      return c.json({ error: 'Failed to get manager token' }, 500)
    }
  })

  app.post('/manager-token/rotate', async (c) => {
    try {
      const token = rotateUserToken(db, currentUserId(c))
      logger.info('Manager token rotated for a user; any client holding the previous one must re-pair')
      return c.json({ token, restartRequired: false })
    } catch (error) {
      logger.error('Failed to rotate manager token:', error)
      return c.json({ error: 'Failed to rotate manager token' }, 500)
    }
  })

  /**
   * Resumable sessions, for the restart flow.
   *
   * `captureResumableSessions` walks one shared OpenCode process, so the
   * result is every tenant's sessions with their absolute directories attached.
   * Handing that to any signed-in user published the other tenants' checkout
   * paths and session ids. Filtered to the caller's own roots now; an admin
   * keeps the unfiltered view because their roots already are the whole
   * workspace.
   */
  app.get('/opencode-active-sessions', (c) => {
    const principal = currentPrincipal(c)
    if (!principal) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    const all = getOpenCodeRestartCoordinator()?.captureResumableSessions() ?? []
    const sessions = principalIsAdmin(principal)
      ? all
      : all.filter((session) => isWithinRoots(session.directory, resolveAccessRoots(db, principal)))
    return c.json({ count: sessions.length, sessions })
  })

  app.get('/opencode-discover-models', async (c) => {
    try {
      const baseUrl = c.req.query('baseUrl')
      const apiKey = c.req.query('apiKey') || ''
      const forceRefresh = c.req.query('refresh') === 'true'

      if (!baseUrl || !baseUrl.trim()) {
        return c.json({ error: 'baseUrl is required' }, 400)
      }

      let parsedUrl: URL
      try {
        parsedUrl = new URL(baseUrl.trim())
      } catch {
        return c.json({ error: 'Invalid baseUrl' }, 400)
      }
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return c.json({ error: 'baseUrl must be an http or https URL' }, 400)
      }

      const trimmedBaseUrl = baseUrl.trim()

      const { models, cached } = await discoverModelsCached({
        baseUrl: trimmedBaseUrl,
        apiKey,
        type: 'opencode-models',
        filterPattern: /.*/,
        defaultModels: [],
        forceRefresh,
      })

      return c.json({ models, cached })
    } catch (error) {
      logger.error('Failed to discover OpenCode models:', error)
      return c.json({ error: 'Failed to discover models' }, 500)
    }
  })

  return app
}
