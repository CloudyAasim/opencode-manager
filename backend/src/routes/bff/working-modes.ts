import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { BffWorkingModeListResponseSchema } from '@opencode-manager/shared/api/bff'
import type { WorkingMode } from '@opencode-manager/shared/api/v1'
import type { Session } from '../../auth'
import type { ProviderRegistry } from '../../providers/registry'
import { principalFrom, resolveAccessRoots } from '../../auth/ownership'
import { handle, ok } from '../api-v1/respond'
import { agentIdOf } from '../api-v1/params'
import { checkedDirectoriesOf } from './params'

/**
 * The ways of working a conversation can be had in.
 *
 * The word "agent" is taken by the program that does the work, so the ways of
 * working have a word of their own - and the client used to learn about them
 * by reading the agent's own list, in the agent's own words, which meant
 * every place that let a person pick a way of working had to speak those
 * words too.
 *
 * So they are asked for here, once, and they come back in the versioned
 * dialect: the same ways of working, whichever agent is behind them.
 *
 * They are not a person's, so they are not narrowed to the caller the way a
 * conversation is - but the working directories they were read from are the
 * caller's, because a directory that is not yours is not yours to read them
 * out of.
 *
 * When several directories are named, the first one answers: a way of working
 * that two directories both have is the same way of working.
 */
export function createBffWorkingModeRoutes(registry: ProviderRegistry, database: Database) {
  const app = new Hono<{ Variables: { session: Session['session']; user: Session['user'] } }>()

  app.get('/', (c) =>
    handle(c, async () => {
      const principal = principalFrom(c.get('user'))
      const roots = resolveAccessRoots(database, principal)

      const checked = checkedDirectoriesOf(c, principal, roots)
      if (checked instanceof Response) return checked

      const provider = registry.resolve(agentIdOf(c))

      // No directory named is not an error: the agent has ways of working of
      // its own that belong to no working directory in particular.
      const directories = checked.length > 0 ? checked : [undefined]
      const answers = await Promise.all(
        directories.map((directory) => provider.listWorkingModes({ directory })),
      )

      const workingModes: WorkingMode[] = []
      const seen = new Set<string>()
      for (const answer of answers) {
        for (const mode of answer) {
          if (seen.has(mode.name)) continue
          seen.add(mode.name)
          workingModes.push(mode)
        }
      }

      return ok(c, BffWorkingModeListResponseSchema, { workingModes })
    }),
  )

  return app
}
