import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Database } from 'bun:sqlite'
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
import type { Session } from '../../auth'
import type { ProviderRegistry } from '../../providers/registry'
import type { ListSessionsParams, ProviderContext } from '../../providers/contract'
import { principalFrom } from '../../auth/ownership'
import { callerVisibleSessions } from '../../services/session-scope'
import { fail, handle, ok } from './respond'

function agentIdOf(c: Context): string | undefined {
  const value = c.req.query('agent')
  return value && value.trim() ? value : undefined
}

function contextOf(c: Context): ProviderContext {
  const directory = c.req.query('directory')
  return directory ? { directory } : {}
}

/**
 * How much of the list to read. A limit that is not a number is no limit,
 * and a cursor that is blank is no cursor: the list starts at its beginning
 * rather than failing on a query string a browser may have trimmed.
 */
function listParamsOf(c: Context): ListSessionsParams {
  const params: ListSessionsParams = {}

  const limit = c.req.query('limit')
  if (limit) {
    const parsed = Number.parseInt(limit, 10)
    if (Number.isFinite(parsed) && parsed > 0) params.limit = parsed
  }

  const cursor = c.req.query('cursor')
  if (cursor && cursor.trim()) params.cursor = cursor

  const search = c.req.query('search')
  if (search && search.trim()) params.search = search

  return params
}

export function createSessionRoutes(registry: ProviderRegistry, database: Database) {
  const app = new Hono<{ Variables: { session: Session['session']; user: Session['user'] } }>()

  app.get('/', (c) =>
    handle(c, async () => {
      const provider = registry.resolve(agentIdOf(c))
      const page = await provider.listSessions(contextOf(c), listParamsOf(c))
      // An agent knows about conversations, not about people. The list it
      // answers with is narrowed here, or it is the whole server's list.
      const principal = principalFrom(c.get('user'))
      const sessions = callerVisibleSessions(database, page.items, principal)
      return ok(c, SessionListResponseSchema, { sessions, nextCursor: page.nextCursor })
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
