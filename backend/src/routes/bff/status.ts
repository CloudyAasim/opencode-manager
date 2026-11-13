import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { BffConversationStatusResponseSchema } from '@opencode-manager/shared/api/bff'
import type { ConversationStatus } from '@opencode-manager/shared/api/v1'
import type { Session } from '../../auth'
import type { ProviderRegistry } from '../../providers/registry'
import { principalFrom, resolveAccessRoots } from '../../auth/ownership'
import { callerVisibleSessions } from '../../services/session-scope'
import { fail, handle, ok } from '../api-v1/respond'
import { agentIdOf } from '../api-v1/params'
import { checkedDirectoriesOf, directoriesOf } from './params'

/**
 * How busy every conversation is.
 *
 * The client used to ask the agent about each working directory separately
 * and merge the answers itself, and it asked on a timer whether anybody was
 * looking or not - so the merging was the client's job, and a client that
 * merged it wrong showed a conversation as idle while it was working.
 *
 * So the statuses are asked for once, here. The directories come in, the agent
 * is asked about each of them, and the answers come back as one map.
 *
 * A status belongs to a conversation, so the conversation decides whose it is.
 * The same rule the conversation list follows: the ledger's owner decides, and
 * a conversation the ledger does not know is decided by the directory it was
 * worked on - which is the directory this answer came from.
 */
export function createBffStatusRoutes(registry: ProviderRegistry, database: Database) {
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

      const answers = await Promise.all(
        directories.map((directory) => provider.listSessionStatuses({ directory })),
      )

      // Each answer belongs to the directory it came from, and that is what
      // says whose conversation it is about when the ledger does not know it.
      const entries = directories.flatMap((directory, index) =>
        Object.entries(answers[index] ?? {}).map(([id, status]) => ({ id, directory, status })),
      )

      const visible = callerVisibleSessions(database, entries, principal)
      const statuses: Record<string, ConversationStatus> = {}
      for (const entry of visible) statuses[entry.id] = entry.status

      return ok(c, BffConversationStatusResponseSchema, { statuses })
    }),
  )

  return app
}
