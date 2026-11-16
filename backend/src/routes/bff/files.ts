import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { BffFileSearchResponseSchema } from '@opencode-manager/shared/api/bff'
import type { Session } from '../../auth'
import type { ProviderRegistry } from '../../providers/registry'
import { principalFrom, resolveAccessRoots } from '../../auth/ownership'
import { fail, handle, ok } from '../api-v1/respond'
import { agentIdOf } from '../api-v1/params'
import { checkedDirectoriesOf } from './params'

/**
 * The files that match a word.
 *
 * The client used to ask the agent about this itself - by building the
 * agent's own path - so the door it walked through was the agent's, and the
 * answer was in the agent's words.
 *
 * It is asked for here instead, and the paths come back the way the agent
 * knows them: whole, and relative to the working directory they are in.
 *
 * A file search is about a working directory, so the directory has to be
 * named and it has to be the caller's - a directory that is not theirs is
 * refused rather than searched.
 */
export function createBffFileRoutes(registry: ProviderRegistry, database: Database) {
  const app = new Hono<{ Variables: { session: Session['session']; user: Session['user'] } }>()

  app.get('/search', (c) =>
    handle(c, async () => {
      const query = c.req.query('query')?.trim()
      if (!query) {
        return fail(c, 400, 'bad_request', 'No word to look for')
      }

      const principal = principalFrom(c.get('user'))
      const roots = resolveAccessRoots(database, principal)

      const checked = checkedDirectoriesOf(c, principal, roots)
      if (checked instanceof Response) return checked
      if (checked.length === 0) {
        return fail(c, 400, 'bad_request', 'No working directory was named')
      }

      const provider = registry.resolve(agentIdOf(c))

      const files = await provider.searchFiles(query, { directory: checked[0] })

      return ok(c, BffFileSearchResponseSchema, { files })
    }),
  )

  return app
}
