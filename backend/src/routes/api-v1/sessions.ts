import { Hono } from 'hono'
import type { Context } from 'hono'
import {
  AcceptedResponseSchema,
  CreateSessionRequestSchema,
  DeletedResponseSchema,
  MessageListResponseSchema,
  RenameSessionRequestSchema,
  SendPromptRequestSchema,
  SessionListResponseSchema,
  SessionResponseSchema,
} from '@opencode-manager/shared/api/v1'
import type { ProviderRegistry } from '../../providers/registry'
import type { ProviderContext } from '../../providers/contract'
import { fail, handle, ok } from './respond'

function agentIdOf(c: Context): string | undefined {
  const value = c.req.query('agent')
  return value && value.trim() ? value : undefined
}

function contextOf(c: Context): ProviderContext {
  const directory = c.req.query('directory')
  return directory ? { directory } : {}
}

export function createSessionRoutes(registry: ProviderRegistry) {
  const app = new Hono()

  app.get('/', (c) =>
    handle(c, async () => {
      const provider = registry.resolve(agentIdOf(c))
      const sessions = await provider.listSessions(contextOf(c))
      return ok(c, SessionListResponseSchema, { sessions })
    }),
  )

  app.post('/', (c) =>
    handle(c, async () => {
      const body = CreateSessionRequestSchema.safeParse(await readJson(c))
      if (!body.success) {
        return fail(c, 400, 'bad_request', 'The request body does not match the contract', body.error.issues)
      }

      const provider = registry.resolve(agentIdOf(c))
      const session = await provider.createSession({
        title: body.data.title,
        directory: body.data.directory ?? contextOf(c).directory,
      })
      return ok(c, SessionResponseSchema, { session })
    }),
  )

  app.get('/:id', (c) =>
    handle(c, async () => {
      const provider = registry.resolve(agentIdOf(c))
      const session = await provider.getSession(c.req.param('id'), contextOf(c))
      if (!session) {
        return fail(c, 404, 'not_found', 'No session is known under that id')
      }
      return ok(c, SessionResponseSchema, { session })
    }),
  )

  app.patch('/:id', (c) =>
    handle(c, async () => {
      const body = RenameSessionRequestSchema.safeParse(await readJson(c))
      if (!body.success) {
        return fail(c, 400, 'bad_request', 'The request body does not match the contract', body.error.issues)
      }

      const provider = registry.resolve(agentIdOf(c))
      const session = await provider.renameSession(c.req.param('id'), body.data.title, contextOf(c))
      return ok(c, SessionResponseSchema, { session })
    }),
  )

  app.delete('/:id', (c) =>
    handle(c, async () => {
      const provider = registry.resolve(agentIdOf(c))
      await provider.deleteSession(c.req.param('id'), contextOf(c))
      return ok(c, DeletedResponseSchema, { deleted: true, id: c.req.param('id') })
    }),
  )

  app.get('/:id/messages', (c) =>
    handle(c, async () => {
      const provider = registry.resolve(agentIdOf(c))
      const messages = await provider.listMessages(c.req.param('id'), contextOf(c))
      return ok(c, MessageListResponseSchema, { messages })
    }),
  )

  app.post('/:id/prompts', (c) =>
    handle(c, async () => {
      const body = SendPromptRequestSchema.safeParse(await readJson(c))
      if (!body.success) {
        return fail(c, 400, 'bad_request', 'The request body does not match the contract', body.error.issues)
      }

      const provider = registry.resolve(agentIdOf(c))
      await provider.sendPrompt(c.req.param('id'), { text: body.data.text }, contextOf(c))
      return ok(c, AcceptedResponseSchema, { accepted: true })
    }),
  )

  app.post('/:id/abort', (c) =>
    handle(c, async () => {
      const provider = registry.resolve(agentIdOf(c))
      await provider.abortSession(c.req.param('id'), contextOf(c))
      return ok(c, AcceptedResponseSchema, { accepted: true })
    }),
  )

  return app
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}
