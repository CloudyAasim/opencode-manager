import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { BffProviderListResponseSchema } from '@opencode-manager/shared/api/bff'
import type { Session } from '../../auth'
import type { ProviderRegistry } from '../../providers/registry'
import { principalFrom, resolveAccessRoots } from '../../auth/ownership'
import { handle, ok } from '../api-v1/respond'
import { agentIdOf } from '../api-v1/params'
import { checkedDirectoriesOf } from './params'

/**
 * The models that may be picked.
 *
 * The client used to read the agent's own catalogue - in the agent's own
 * words, megabytes long, credentials and all - and every place that drew a
 * picker had to speak those words too.
 *
 * So the catalogue is asked for here, once, and it comes back in the
 * versioned dialect: the providers, the models, what each model can do, and
 * which of the providers is ready to be used. The credentials stay where they
 * are - the browser never had a reason to know them.
 *
 * The catalogue belongs to the agent rather than to a working directory: it is
 * the same catalogue whichever directory is named. So the first directory
 * answers, and when none was named the agent answers for itself.
 */
export function createBffProviderRoutes(registry: ProviderRegistry, database: Database) {
  const app = new Hono<{ Variables: { session: Session['session']; user: Session['user'] } }>()

  app.get('/', (c) =>
    handle(c, async () => {
      const principal = principalFrom(c.get('user'))
      const roots = resolveAccessRoots(database, principal)

      const checked = checkedDirectoriesOf(c, principal, roots)
      if (checked instanceof Response) return checked

      const provider = registry.resolve(agentIdOf(c))

      const answer = await provider.listProviders({ directory: checked[0] })

      return ok(c, BffProviderListResponseSchema, answer)
    }),
  )

  return app
}
