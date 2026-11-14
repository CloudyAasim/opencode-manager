import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { BffAgentDefaultsResponseSchema } from '@opencode-manager/shared/api/bff'
import type { Session } from '../../auth'
import type { ProviderRegistry } from '../../providers/registry'
import { principalFrom, resolveAccessRoots } from '../../auth/ownership'
import { handle, ok } from '../api-v1/respond'
import { agentIdOf } from '../api-v1/params'
import { checkedDirectoriesOf } from './params'

/**
 * What the agent does by default.
 *
 * Two things: the model a conversation starts on, and the way of working it
 * starts in. The client used to read the agent's whole configuration for
 * these - which meant holding a shape that is the agent's own, full of fields
 * the client never reads and that change whenever the agent changes them.
 *
 * So the layer answers with the two, in the versioned dialect, and the rest
 * of the configuration stays the agent's business.
 *
 * The defaults are one answer and not a list, so when several working
 * directories are named the first one answers - the directories are asked in
 * the order they were named, and a client that wants another directory's
 * defaults asks for that directory.
 */
export function createBffDefaultRoutes(registry: ProviderRegistry, database: Database) {
  const app = new Hono<{ Variables: { session: Session['session']; user: Session['user'] } }>()

  app.get('/', (c) =>
    handle(c, async () => {
      const principal = principalFrom(c.get('user'))
      const roots = resolveAccessRoots(database, principal)

      const checked = checkedDirectoriesOf(c, principal, roots)
      if (checked instanceof Response) return checked

      const provider = registry.resolve(agentIdOf(c))

      const directory = checked[0]
      const defaults = await provider.getDefaults(directory ? { directory } : {})

      return ok(c, BffAgentDefaultsResponseSchema, { defaults })
    }),
  )

  return app
}
