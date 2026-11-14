import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Database } from 'bun:sqlite'
import { BffSessionListResponseSchema } from '@opencode-manager/shared/api/bff'
import {
  AcceptedResponseSchema,
  CreateSessionRequestSchema,
  DeletedResponseSchema,
  ForkRequestSchema,
  MessageListResponseSchema,
  PermissionReplySchema,
  QuestionReplySchema,
  RenameSessionRequestSchema,
  SendCommandRequestSchema,
  SendPromptRequestSchema,
  SessionResponseSchema,
  SessionRevertSchema,
  ShellRequestSchema,
  SummarizeRequestSchema,
} from '@opencode-manager/shared/api/v1'
import type { Session } from '../../auth'
import type { Session as Conversation } from '@opencode-manager/shared/api/v1'
import type { ProviderRegistry } from '../../providers/registry'
import type { ProviderContext } from '../../providers/contract'
import { principalFrom, principalIsAdmin, resolveAccessRoots } from '../../auth/ownership'
import { isWithinRoots } from '../../auth/access-scope'
import { callerVisibleSessions, sessionVisibleTo } from '../../services/session-scope'
import { recordAgentSession } from '../../services/agent-session'
import { locateSession } from '../../services/session-directory'
import { fail, handle, ok } from '../api-v1/respond'
import { agentIdOf } from '../api-v1/params'
import { checkedDirectoriesOf, directoriesOf } from './params'

/**
 * The conversations the web client asks for.
 *
 * The client used to do this work itself: it had a list of working
 * directories, it asked the agent for one page from each of them, it merged
 * the pages and it kept one cursor per directory so it could ask for the next
 * page of each in turn. That is a server's job wearing a client's clothes -
 * the browser paid for N round trips to draw one list, and every place that
 * drew a list had to know how to merge pages.
 *
 * So the list is asked for once, here. The directories come in, the agent is
 * asked once per directory, the pages are merged, and each directory's cursor
 * comes back so the client can ask for the next round.
 *
 * The limit is per directory, exactly as it was when the client did this: a
 * client that asked for twenty-five sessions and had three directories got
 * seventy-five, and it still gets seventy-five.
 *
 * One conversation is the same story told about a single thing. The client
 * named the conversation *and* the working directory it lived in, because the
 * versioned API asks about one agent in one directory at a time. Here the
 * client names the conversation and this layer works out where it lives - the
 * ledger knows, or the agent knows, or the caller's own directories know. A
 * client that kept its own map of conversations to directories was a client
 * with one more thing to get wrong.
 */
export function createBffSessionRoutes(registry: ProviderRegistry, database: Database) {
  const app = new Hono<{ Variables: { session: Session['session']; user: Session['user'] } }>()

  app.get('/', (c) =>
    handle(c, async () => {
      const principal = principalFrom(c.get('user'))
      const roots = resolveAccessRoots(database, principal)

      const directories = directoriesOf(c)
      if (directories.length === 0) {
        return fail(c, 400, 'bad_request', 'Name at least one working directory to list')
      }

      // A directory is the caller's to name only if it is one of theirs. The
      // sessions themselves are filtered further down, but a directory that
      // is not theirs has no business being named at all.
      const checked = checkedDirectoriesOf(c, principal, roots)
      if (checked instanceof Response) return checked

      const provider = registry.resolve(agentIdOf(c))
      const limit = limitOf(c)
      const search = searchOf(c)
      const cursors = cursorsOf(c)

      const pages = await Promise.all(
        directories.map((directory) =>
          provider.listSessions({ directory }, { limit, cursor: cursors[directory], search }),
        ),
      )

      const merged = pages.flatMap((page) => page.items)
      const visible = callerVisibleSessions(database, merged, principal)

      const nextCursors: Record<string, string> = {}
      pages.forEach((page, index) => {
        const directory = directories[index]!
        if (page.nextCursor) nextCursors[directory] = page.nextCursor
      })

      return ok(c, BffSessionListResponseSchema, {
        sessions: visible.sort((left, right) => right.updatedAt - left.updatedAt),
        cursors: nextCursors,
      })
    }),
  )

  app.post('/', (c) =>
    handle(c, async () => {
      const body = CreateSessionRequestSchema.safeParse(await readJson(c))
      if (!body.success) {
        return fail(c, 400, 'bad_request', 'The request body does not match the contract', body.error.issues)
      }

      const principal = principalFrom(c.get('user'))
      if (!principal) {
        return fail(c, 401, 'unauthorized', 'No session')
      }
      const roots = resolveAccessRoots(database, principal)

      // A conversation is worked on in a directory, and the directory is the
      // caller's to name only if it is one of theirs.
      const directory = body.data.directory
      if (!directory) {
        return fail(c, 400, 'bad_request', 'Name the working directory the conversation is created in')
      }
      if (!principalIsAdmin(principal) && !isWithinRoots(directory, roots)) {
        return fail(c, 403, 'forbidden', 'A working directory that is not yours was named')
      }

      const provider = registry.resolve(agentIdOf(c))
      const session = await provider.createSession({ title: body.data.title, directory })

      // This is the one moment where both halves of the answer exist at the
      // same time: who asked, and which id came back. The ledger is what lets
      // every later request tell one person's conversation from another's, so
      // it is written here - the same moment the request that created it
      // through the browser's other door writes it.
      recordAgentSession(database, {
        sessionId: session.id,
        userId: principal.id,
        username: principal.username ?? null,
        role: principal.role,
        directory,
        source: 'bff',
      })

      return ok(c, SessionResponseSchema, { session })
    }),
  )

  app.get('/:id', (c) =>
    handle(c, async () => {
      const located = await locate(c, registry, database)
      if (located instanceof Response) return located
      if (!located.session) {
        return fail(c, 404, 'not_found', 'No session is known under that id')
      }
      return ok(c, SessionResponseSchema, { session: located.session })
    }),
  )

  app.patch('/:id', (c) =>
    handle(c, async () => {
      const body = RenameSessionRequestSchema.safeParse(await readJson(c))
      if (!body.success) {
        return fail(c, 400, 'bad_request', 'The request body does not match the contract', body.error.issues)
      }

      const located = await locate(c, registry, database)
      if (located instanceof Response) return located
      if (!located.session) {
        return fail(c, 404, 'not_found', 'No session is known under that id')
      }

      const provider = located.provider
      const session = await provider.renameSession(
        c.req.param('id'),
        body.data.title,
        contextOf(located.directory),
      )
      return ok(c, SessionResponseSchema, { session })
    }),
  )

  app.delete('/:id', (c) =>
    handle(c, async () => {
      const located = await locate(c, registry, database)
      if (located instanceof Response) return located
      if (!located.session) {
        return fail(c, 404, 'not_found', 'No session is known under that id')
      }

      const provider = located.provider
      await provider.deleteSession(c.req.param('id'), contextOf(located.directory))
      return ok(c, DeletedResponseSchema, { deleted: true, id: c.req.param('id') })
    }),
  )

  app.post('/:id/abort', (c) =>
    handle(c, async () => {
      const located = await locate(c, registry, database)
      if (located instanceof Response) return located
      if (!located.session) {
        return fail(c, 404, 'not_found', 'No session is known under that id')
      }

      const provider = located.provider
      await provider.abortSession(c.req.param('id'), contextOf(located.directory))
      return ok(c, AcceptedResponseSchema, { accepted: true })
    }),
  )

  /**
   * What was said in one conversation.
   *
   * The client used to ask the agent for this itself, and it had to know
   * which agent and which working directory the conversation lived in before
   * it could ask. Here it names the conversation, and this layer works out
   * where it lives - and refuses the answer when the conversation is not the
   * caller's.
   */
  app.get('/:id/messages', (c) =>
    handle(c, async () => {
      const located = await locate(c, registry, database)
      if (located instanceof Response) return located
      if (!located.session) {
        return fail(c, 404, 'not_found', 'No session is known under that id')
      }

      const provider = located.provider
      const messages = await provider.listMessages(c.req.param('id'), contextOf(located.directory))
      return ok(c, MessageListResponseSchema, { messages })
    }),
  )

  /**
   * Saying something to one conversation.
   *
   * The words, the files that go with them, and the model and the agent that
   * should answer all travel together, so that the conversation is answered
   * the way the caller asked for and not the way the server felt like.
   */
  app.post('/:id/prompts', (c) =>
    handle(c, async () => {
      const body = SendPromptRequestSchema.safeParse(await readJson(c))
      if (!body.success) {
        return fail(c, 400, 'bad_request', 'The request body does not match the contract', body.error.issues)
      }

      const located = await locate(c, registry, database)
      if (located instanceof Response) return located
      if (!located.session) {
        return fail(c, 404, 'not_found', 'No session is known under that id')
      }

      const provider = located.provider
      await provider.sendPrompt(
        c.req.param('id'),
        {
          parts: body.data.parts,
          model: body.data.model,
          agent: body.data.agent,
          variant: body.data.variant,
        },
        contextOf(located.directory),
      )
      return ok(c, AcceptedResponseSchema, { accepted: true })
    }),
  )

  /**
   * Taking a message back.
   *
   * The conversation is rolled back to the message that is named, and
   * everything after it stops counting. The layer works out where the
   * conversation lives, and refuses the answer when the conversation is not
   * the caller's.
   */
  app.post('/:id/revert', (c) =>
    handle(c, async () => {
      const body = SessionRevertSchema.safeParse(await readJson(c))
      if (!body.success) {
        return fail(c, 400, 'bad_request', 'The request body does not match the contract', body.error.issues)
      }

      const located = await locate(c, registry, database)
      if (located instanceof Response) return located
      if (!located.session) {
        return fail(c, 404, 'not_found', 'No session is known under that id')
      }

      const provider = located.provider
      const session = await provider.revertSession(
        c.req.param('id'),
        { messageId: body.data.messageId, partId: body.data.partId },
        contextOf(located.directory),
      )
      return ok(c, SessionResponseSchema, { session })
    }),
  )

  /**
   * Answering a permission request.
   *
   * The permission hangs on a conversation, so the conversation decides whose
   * it is - and the layer works out where the conversation lives, the same way
   * it does for everything else about a conversation. A conversation that is
   * not the caller's is refused the same way one that does not exist is.
   */
  app.post('/:id/permissions/:permissionId/reply', (c) =>
    handle(c, async () => {
      const body = PermissionReplySchema.safeParse(await readJson(c))
      if (!body.success) {
        return fail(c, 400, 'bad_request', 'The request body does not match the contract', body.error.issues)
      }

      const located = await locate(c, registry, database)
      if (located instanceof Response) return located
      if (!located.session) {
        return fail(c, 404, 'not_found', 'No session is known under that id')
      }

      const provider = located.provider
      await provider.respondToPermission(
        c.req.param('permissionId'),
        body.data.reply,
        contextOf(located.directory),
      )
      return ok(c, AcceptedResponseSchema, { accepted: true })
    }),
  )

  /**
   * Answering a question.
   *
   * A question may have more than one part, and the answers come back in the
   * order the parts were asked.
   */
  app.post('/:id/questions/:questionId/reply', (c) =>
    handle(c, async () => {
      const body = QuestionReplySchema.safeParse(await readJson(c))
      if (!body.success) {
        return fail(c, 400, 'bad_request', 'The request body does not match the contract', body.error.issues)
      }

      const located = await locate(c, registry, database)
      if (located instanceof Response) return located
      if (!located.session) {
        return fail(c, 404, 'not_found', 'No session is known under that id')
      }

      const provider = located.provider
      await provider.replyToQuestion(
        c.req.param('questionId'),
        body.data.answers,
        contextOf(located.directory),
      )
      return ok(c, AcceptedResponseSchema, { accepted: true })
    }),
  )

  /**
   * Turning a question down.
   *
   * The same conversation, the same rules: the question hangs on it, so the
   * conversation decides whose it is.
   */
  app.post('/:id/questions/:questionId/reject', (c) =>
    handle(c, async () => {
      const located = await locate(c, registry, database)
      if (located instanceof Response) return located
      if (!located.session) {
        return fail(c, 404, 'not_found', 'No session is known under that id')
      }

      const provider = located.provider
      await provider.rejectQuestion(c.req.param('questionId'), contextOf(located.directory))
      return ok(c, AcceptedResponseSchema, { accepted: true })
    }),
  )

  /**
   * Running a command in a conversation.
   *
   * A command hangs on a conversation, so the conversation decides whose it
   * is - and the layer works out where the conversation lives, the same way
   * it does for everything else about a conversation.
   *
   * The answer is a message in the conversation, so it is read from there
   * rather than carried back here: a prompt's answer is not carried back
   * either, and the two are the same kind of thing.
   */
  app.post('/:id/commands', (c) =>
    handle(c, async () => {
      const body = SendCommandRequestSchema.safeParse(await readJson(c))
      if (!body.success) {
        return fail(c, 400, 'bad_request', 'The request body does not match the contract', body.error.issues)
      }

      const located = await locate(c, registry, database)
      if (located instanceof Response) return located
      if (!located.session) {
        return fail(c, 404, 'not_found', 'No session is known under that id')
      }

      const provider = located.provider
      await provider.sendCommand(
        c.req.param('id'),
        {
          command: body.data.command,
          arguments: body.data.arguments,
          workingMode: body.data.workingMode,
          model: body.data.model,
        },
        contextOf(located.directory),
      )
      return ok(c, AcceptedResponseSchema, { accepted: true })
    }),
  )

  /**
   * Shortening a conversation.
   *
   * The model that writes the summary is named by the caller, because a
   * summary is an answer and an answer is written by somebody.
   */
  app.post('/:id/summarize', (c) =>
    handle(c, async () => {
      const body = SummarizeRequestSchema.safeParse(await readJson(c))
      if (!body.success) {
        return fail(c, 400, 'bad_request', 'The request body does not match the contract', body.error.issues)
      }

      const located = await locate(c, registry, database)
      if (located instanceof Response) return located
      if (!located.session) {
        return fail(c, 404, 'not_found', 'No session is known under that id')
      }

      const provider = located.provider
      await provider.summarizeSession(
        c.req.param('id'),
        body.data.model,
        contextOf(located.directory),
      )
      return ok(c, AcceptedResponseSchema, { accepted: true })
    }),
  )

  /**
   * Taking a copy of a conversation.
   *
   * The copy is a conversation like any other, and it belongs to whoever
   * asked for it - so it is written down in the ledger at the moment it is
   * made, the same way a conversation made through the browser's other door
   * is.
   */
  app.post('/:id/fork', (c) =>
    handle(c, async () => {
      const body = ForkRequestSchema.safeParse(await readJson(c))
      if (!body.success) {
        return fail(c, 400, 'bad_request', 'The request body does not match the contract', body.error.issues)
      }

      const located = await locate(c, registry, database)
      if (located instanceof Response) return located
      if (!located.session) {
        return fail(c, 404, 'not_found', 'No session is known under that id')
      }

      const provider = located.provider
      const session = await provider.forkSession(
        c.req.param('id'),
        { messageId: body.data.messageId },
        contextOf(located.directory),
      )

      const principal = principalFrom(c.get('user'))
      if (principal) {
        recordAgentSession(database, {
          sessionId: session.id,
          userId: principal.id,
          username: principal.username ?? null,
          role: principal.role,
          directory: session.directory ?? located.directory,
          source: 'bff',
        })
      }

      return ok(c, SessionResponseSchema, { session })
    }),
  )

  /**
   * Running a command in a conversation's own shell.
   *
   * The shell belongs to the conversation, so the conversation decides whose
   * it is.
   */
  app.post('/:id/shell', (c) =>
    handle(c, async () => {
      const body = ShellRequestSchema.safeParse(await readJson(c))
      if (!body.success) {
        return fail(c, 400, 'bad_request', 'The request body does not match the contract', body.error.issues)
      }

      const located = await locate(c, registry, database)
      if (located instanceof Response) return located
      if (!located.session) {
        return fail(c, 404, 'not_found', 'No session is known under that id')
      }

      const provider = located.provider
      await provider.sendShell(
        c.req.param('id'),
        { command: body.data.command, workingMode: body.data.workingMode },
        contextOf(located.directory),
      )
      return ok(c, AcceptedResponseSchema, { accepted: true })
    }),
  )

  return app
}

/**
 * The conversation a request is about, and whether the caller may touch it.
 *
 * The place of the conversation is worked out rather than asked for, and the
 * answer is refused when the conversation is not the caller's. It is refused
 * the same way a conversation that does not exist is refused: a caller who
 * may not have it should not be able to learn that it is there.
 */
async function locate(
  c: Context,
  registry: ProviderRegistry,
  database: Database,
): Promise<
  | { session: Conversation | null; directory: string | null; provider: ReturnType<ProviderRegistry['resolve']> }
  | Response
> {
  const principal = principalFrom(c.get('user'))
  const roots = resolveAccessRoots(database, principal)

  const directories = checkedDirectoriesOf(c, principal, roots)
  if (directories instanceof Response) return directories

  const provider = registry.resolve(agentIdOf(c))
  const sessionId = c.req.param('id')
  const location = await locateSession(database, provider, sessionId, directories)

  const visible = sessionVisibleTo(
    { id: sessionId, directory: location.directory },
    location.record,
    principal,
    roots,
  )
  if (!visible) {
    return fail(c, 404, 'not_found', 'No session is known under that id')
  }
  return { session: location.session, directory: location.directory, provider }
}

/** Where the agent is working, when the place of the conversation is known. */
function contextOf(directory: string | null): ProviderContext {
  return directory ? { directory } : {}
}

function limitOf(c: Context): number | undefined {
  const raw = c.req.query('limit')
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function searchOf(c: Context): string | undefined {
  const raw = c.req.query('search')
  return raw && raw.trim() ? raw : undefined
}

/**
 * Where each directory's next page starts.
 *
 * A cursor that cannot be read is no cursor: the list starts at its
 * beginning rather than the request failing, because a client that has
 * already been given a page it cannot describe is better served by the first
 * page than by an error.
 */
function cursorsOf(c: Context): Record<string, string> {
  const raw = c.req.query('cursors')
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const cursors: Record<string, string> = {}
  for (const [directory, cursor] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof cursor === 'string' && cursor) cursors[directory] = cursor
  }
  return cursors
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}
