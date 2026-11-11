import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Database } from 'bun:sqlite'
import { BffSessionListResponseSchema } from '@opencode-manager/shared/api/bff'
import type { Session } from '../../auth'
import type { ProviderRegistry } from '../../providers/registry'
import { principalFrom, principalIsAdmin, resolveAccessRoots } from '../../auth/ownership'
import { isWithinRoots } from '../../auth/access-scope'
import { callerVisibleSessions } from '../../services/session-scope'
import { fail, handle, ok } from '../api-v1/respond'
import { agentIdOf } from '../api-v1/params'
import { directoriesOf } from './params'

/**
 * The session list the web client asks for.
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
      if (!principalIsAdmin(principal)) {
        const strayed = directories.filter((directory) => !isWithinRoots(directory, roots))
        if (strayed.length > 0) {
          return fail(c, 403, 'forbidden', 'A working directory that is not yours was named')
        }
      }

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

  return app
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
