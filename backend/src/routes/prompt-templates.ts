import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import {
  CreatePromptTemplateRequestSchema,
  UpdatePromptTemplateRequestSchema,
} from '@opencode-manager/shared/schemas'
import { PromptTemplateService, PromptTemplateServiceError } from '../services/prompt-templates'
import { parseId, handleServiceError } from '../utils/route-helpers'
import { principalFrom } from '../auth/ownership'
import type { Session } from '../auth'

export function createPromptTemplateRoutes(database: Database) {
  const app = new Hono()
  const service = new PromptTemplateService(database)

  const principalOf = (c: unknown) =>
    principalFrom((c as { get?: (key: string) => Session['user'] | undefined }).get?.('user'))

  app.get('/', (c) => {
    try {
      return c.json({ templates: service.list(principalOf(c)) })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list templates', PromptTemplateServiceError)
    }
  })

  app.post('/', async (c) => {
    try {
      const body = await c.req.json()
      const input = CreatePromptTemplateRequestSchema.parse(body)
      const template = service.create(input, principalOf(c))
      return c.json({ template }, 201)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to create template', PromptTemplateServiceError)
    }
  })

  app.get('/:id', (c) => {
    try {
      const id = parseId(c.req.param('id'), 'id', PromptTemplateServiceError)
      return c.json({ template: service.getById(id, principalOf(c)) })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to get template', PromptTemplateServiceError)
    }
  })

  app.patch('/:id', async (c) => {
    try {
      const id = parseId(c.req.param('id'), 'id', PromptTemplateServiceError)
      const body = await c.req.json()
      const input = UpdatePromptTemplateRequestSchema.parse(body)
      const template = service.update(id, input, principalOf(c))
      return c.json({ template })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to update template', PromptTemplateServiceError)
    }
  })

  app.delete('/:id', (c) => {
    try {
      const id = parseId(c.req.param('id'), 'id', PromptTemplateServiceError)
      service.delete(id, principalOf(c))
      return c.body(null, 204)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to delete template', PromptTemplateServiceError)
    }
  })

  return app
}
