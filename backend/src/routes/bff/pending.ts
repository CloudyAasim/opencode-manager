import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { PendingListResponseSchema } from '@opencode-manager/shared/api/v1'
import type { Session } from '../../auth'
import type { ProviderRegistry } from '../../providers/registry'
import { principalFrom, resolveAccessRoots } from '../../auth/ownership'
import { callerVisiblePendingRequests } from '../../services/session-scope'
import { fail, handle, ok } from '../api-v1/respond'
import { agentIdOf } from '../api-v1/params'
import { checkedDirectoriesOf, directoriesOf } from './params'

/**
 * What the agent is waiting for, across every working directory.
 *
 * The client used to ask for this itself: it had a list of working
 * directories, it asked the agent for the pending permissions of each of them
 * and the pending questions of each of them - two requests per directory -
 * and it worked out which conversation each request belonged to. That is the
 * server's job, and it is the same job the session list used to do by hand.
 *
 * So the list is asked for once, here. The directories come in, the agent is
 * asked about each of them, and the answers come back as one list.
 *
 * A request belongs to a conversation, so the conversation decides whose it
 * is. An agent knows about conversations, not about people.
 */
export function createBffPendingRoutes(registry: ProviderRegistry, database: Database) {
  const app = new Hono<{ Variables: { session: Session['session']; user: Session['user'] } }>()

  app.get('/', (c) =>
    handle(c, async () => {
      const principal = principalFrom(c.get('user'))
      const roots = resolveAccessRoots(database, principal)

      const directories = directoriesOf(c)
      if (directories.length === 0) {
        return fail(c, 400, 'bad_request', 'Name at least one working directory to list')
      }

      // A directory is the caller's to name only if it is one of theirs. A
      // directory that is not theirs has no business being named at all.
      const checked = checkedDirectoriesOf(c, principal, roots)
      if (checked instanceof Response) return checked

      const provider = registry.resolve(agentIdOf(c))

      const [permissions, questions] = await Promise.all([
        Promise.all(
          directories.map((directory) => provider.listPendingPermissions({ directory })),
        ),
        Promise.all(
          directories.map((directory) => provider.listPendingQuestions({ directory })),
        ),
      ])

      const visiblePermissions = callerVisiblePendingRequests(
        database,
        permissions.flat(),
        principal,
      )
      const visibleQuestions = callerVisiblePendingRequests(database, questions.flat(), principal)

      return ok(c, PendingListResponseSchema, {
        permissions: visiblePermissions,
        questions: visibleQuestions,
      })
    }),
  )

  return app
}
