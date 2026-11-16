import { Hono } from 'hono'
import { z } from 'zod'
import { logger } from '../utils/logger'
import type { OpenCodeClient } from '../services/opencode/client'
import type { OpenCodeSupervisor } from '../services/opencode-supervisor'
import {
  addRecentModel,
  ModelSelectionSchema,
  readOpenCodeModelState,
  removeRecentModel,
  toggleFavoriteModel,
  updateOpenCodeModelState,
} from '../services/opencode-model-state'

const UpdateModelStateSchema = z.object({
  recent: ModelSelectionSchema.optional(),
  favorite: ModelSelectionSchema.optional(),
  removeRecent: ModelSelectionSchema.optional(),
}).strict()

export function createProvidersRoutes(_openCodeClient: OpenCodeClient, _openCodeSupervisor?: OpenCodeSupervisor) {
  const app = new Hono()

  app.get('/model-state', async (c) => {
    try {
      const state = await readOpenCodeModelState()
      return c.json(state)
    } catch (error) {
      logger.error('Failed to read OpenCode model state:', error)
      return c.json({ recent: [], favorite: [], variant: {} })
    }
  })

  app.post('/model-state', async (c) => {
    try {
      const body = await c.req.json()
      const validated = UpdateModelStateSchema.parse(body)

      const nextState = await updateOpenCodeModelState((state) => {
        if (validated.favorite) {
          return toggleFavoriteModel(state, validated.favorite)
        }
        if (validated.recent) {
          return addRecentModel(state, validated.recent)
        }
        if (validated.removeRecent) {
          return removeRecentModel(state, validated.removeRecent)
        }
        return state
      })

      return c.json(nextState)
    } catch (error) {
      logger.error('Failed to update OpenCode model state:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update OpenCode model state' }, 500)
    }
  })

  /**
   * The credentials of a provider are not asked for here any more.
   *
   * They are the manager's own - written into the configuration of the person
   * who typed them - and they are now kept behind the layer the client talks
   * to, so that the client asks one place how a model gets logged in rather
   * than two.
   */

  return app
}
