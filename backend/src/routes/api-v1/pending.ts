import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { PendingListResponseSchema } from '@opencode-manager/shared/api/v1'
import type { Session } from '../../auth'
import type { ProviderRegistry } from '../../providers/registry'
import { principalFrom } from '../../auth/ownership'
import { callerVisiblePendingRequests } from '../../services/session-scope'
import { handle, ok } from './respond'
import { agentIdOf, contextOf } from './params'

/**
 * What the agent is waiting for.
 *
 * A permission and a question both belong to a conversation, so the
 * conversation decides whose they are: an agent knows about conversations,
 * not about people.
 */
export function createPendingRoutes(registry: ProviderRegistry, database: Database) {
  const app = new Hono<{ Variables: { session: Session['session']; user: Session['user'] } }>()

  app.get('/', (c) =>
    handle(c, async () => {
      const provider = registry.resolve(agentIdOf(c))
      const context = contextOf(c)

      const [permissions, questions] = await Promise.all([
        provider.listPendingPermissions(context),
        provider.listPendingQuestions(context),
      ])

      const principal = principalFrom(c.get('user'))
      return ok(c, PendingListResponseSchema, {
        permissions: callerVisiblePendingRequests(database, permissions, principal),
        questions: callerVisiblePendingRequests(database, questions, principal),
      })
    }),
  )

  return app
}
