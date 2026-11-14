import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { BffCommandListResponseSchema } from '@opencode-manager/shared/api/bff'
import type { Command } from '@opencode-manager/shared/api/v1'
import type { Session } from '../../auth'
import type { ProviderRegistry } from '../../providers/registry'
import { principalFrom, resolveAccessRoots } from '../../auth/ownership'
import { handle, ok } from '../api-v1/respond'
import { agentIdOf } from '../api-v1/params'
import { checkedDirectoriesOf } from './params'

/**
 * The commands the agent knows.
 *
 * A command is a named thing the agent can be told to do, and the client used
 * to ask the agent for them itself - which meant the client held the agent's
 * own words about them, and that every place that drew a command palette had
 * to speak those words too.
 *
 * So they are asked for here, once, and they come back in the versioned
 * dialect: the same command is the same command whichever agent is behind it.
 *
 * The commands are not a person's, so they are not narrowed to the caller the
 * way a conversation is - but the working directories they were read from are
 * the caller's, because a directory that is not yours is not yours to read
 * commands out of.
 *
 * When several directories are named, the first one answers: a command that
 * two directories both have is the same command, and the directories are
 * asked in the order they were named.
 */
export function createBffCommandRoutes(registry: ProviderRegistry, database: Database) {
  const app = new Hono<{ Variables: { session: Session['session']; user: Session['user'] } }>()

  app.get('/', (c) =>
    handle(c, async () => {
      const principal = principalFrom(c.get('user'))
      const roots = resolveAccessRoots(database, principal)

      const checked = checkedDirectoriesOf(c, principal, roots)
      if (checked instanceof Response) return checked

      const provider = registry.resolve(agentIdOf(c))

      // No directory named is not an error: the agent has commands of its own
      // that belong to no working directory in particular.
      const directories = checked.length > 0 ? checked : [undefined]
      const answers = await Promise.all(
        directories.map((directory) => provider.listCommands({ directory })),
      )

      const commands: Command[] = []
      const seen = new Set<string>()
      for (const answer of answers) {
        for (const command of answer) {
          if (seen.has(command.name)) continue
          seen.add(command.name)
          commands.push(command)
        }
      }

      return ok(c, BffCommandListResponseSchema, { commands })
    }),
  )

  return app
}
