import { Hono } from 'hono'
import { z } from 'zod'
import { logger } from '../../utils/logger'
import { discoverModelsCached } from '../../utils/discovery-cache'
import { opencodeServerManager } from '../../services/opencode-single-server'
import { getOrCreateInternalToken, rotateInternalToken } from '../../services/internal-token'
import { sseAggregator } from '../../services/sse-aggregator'
import { restartOpenCode, getOpenCodeRestartCoordinator } from '../../services/opencode-restart'
import { ENV } from '@opencode-manager/shared/config/env'
import type { SettingsRouteContext } from './context'
import * as helpers from './helpers'

export function createSystemRoutes(ctx: SettingsRouteContext) {
  const { db, openCodeSupervisor, settingsService } = ctx
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
      const validated = helpers.OpenCodeServerAuthBodySchema.parse(body)
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

  app.get('/manager-token', async (c) => {
    try {
      const token = getOrCreateInternalToken(db)
      return c.json({ token })
    } catch (error) {
      logger.error('Failed to get manager token:', error)
      return c.json({ error: 'Failed to get manager token' }, 500)
    }
  })

  app.post('/manager-token/rotate', async (c) => {
    try {
      const token = rotateInternalToken(db)
      logger.info('Manager token rotated, marking OpenCode server restart as pending')
      opencodeServerManager.markRestartPending()
      return c.json({ token, restartRequired: true })
    } catch (error) {
      logger.error('Failed to rotate manager token:', error)
      return c.json({ error: 'Failed to rotate manager token' }, 500)
    }
  })

  app.get('/opencode-active-sessions', (c) => {
    const sessions = getOpenCodeRestartCoordinator()?.captureResumableSessions() ?? []
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
