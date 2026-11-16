import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Database } from 'bun:sqlite'
import {
  BffAcceptedResponseSchema,
  BffAddMcpServerRequestSchema,
  BffMcpServerListResponseSchema,
} from '@opencode-manager/shared/api/bff'
import type { Session } from '../../auth'
import type { ProviderRegistry } from '../../providers/registry'
import { principalFrom, principalIsAdmin, resolveAccessRoots } from '../../auth/ownership'
import { fail, handle, ok } from '../api-v1/respond'
import { agentIdOf } from '../api-v1/params'
import { checkedDirectoriesOf, directoriesOf } from './params'

type McpContext = Context<{ Variables: { session: Session['session']; user: Session['user'] } }>

/**
 * The tool servers.
 *
 * The client used to ask the agent about these itself - for the state of each
 * server, and for the document they are written down in. That document is
 * also where the credentials of every model provider on the host live, so
 * asking for it handed the browser the keys to every model this server can
 * reach.
 *
 * So the servers are asked for here, and what comes back is the servers: the
 * state of each one, and enough of its shape to draw it. The document stays
 * where it was written down.
 */
export function createBffMcpRoutes(registry: ProviderRegistry, database: Database) {
  const app = new Hono<{ Variables: { session: Session['session']; user: Session['user'] } }>()

  app.get('/', (c) =>
    handle(c, async () => {
      const principal = principalFrom(c.get('user'))
      const roots = resolveAccessRoots(database, principal)

      const checked = checkedDirectoriesOf(c, principal, roots)
      if (checked instanceof Response) return checked

      const provider = registry.resolve(agentIdOf(c))

      const servers = await provider.listMcpServers(checked[0] ? { directory: checked[0] } : {})

      return ok(c, BffMcpServerListResponseSchema, { servers })
    }),
  )

  /**
   * Adding a tool server.
   *
   * A server is written into the configuration the whole host reads, so it is
   * everybody's business - and the administrator's to write down.
   */
  app.post('/', (c) =>
    handle(c, async () => {
      const principal = principalFrom(c.get('user'))
      if (!principalIsAdmin(principal)) {
        return fail(c, 403, 'forbidden', 'Only an administrator may add a tool server')
      }

      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        return fail(c, 400, 'bad_request', 'The body is not JSON')
      }

      const parsed = BffAddMcpServerRequestSchema.safeParse(body)
      if (!parsed.success) {
        return fail(c, 400, 'bad_request', 'That is not a tool server', parsed.error.issues)
      }

      const provider = registry.resolve(agentIdOf(c))
      await provider.addMcpServer(parsed.data.name, parsed.data.config, {})

      return ok(c, BffAcceptedResponseSchema, { accepted: true })
    }),
  )

  app.post('/:name/connect', (c) =>
    handle(c, async () => {
      const scope = await scopeOf(c, database)
      if (scope instanceof Response) return scope

      const provider = registry.resolve(agentIdOf(c))
      await provider.connectMcpServer(c.req.param('name'), scope)

      return ok(c, BffAcceptedResponseSchema, { accepted: true })
    }),
  )

  app.post('/:name/disconnect', (c) =>
    handle(c, async () => {
      const scope = await scopeOf(c, database)
      if (scope instanceof Response) return scope

      const provider = registry.resolve(agentIdOf(c))
      await provider.disconnectMcpServer(c.req.param('name'), scope)

      return ok(c, BffAcceptedResponseSchema, { accepted: true })
    }),
  )

  /**
   * Asking a server to authorize itself.
   */
  app.post('/:name/auth/authenticate', (c) =>
    handle(c, async () => {
      const scope = await scopeOf(c, database)
      if (scope instanceof Response) return scope

      const provider = registry.resolve(agentIdOf(c))
      await provider.authenticateMcpServer(c.req.param('name'), scope)

      return ok(c, BffAcceptedResponseSchema, { accepted: true })
    }),
  )

  /**
   * Finishing an authorization.
   */
  app.post('/:name/auth/callback', (c) =>
    handle(c, async () => {
      const scope = await scopeOf(c, database)
      if (scope instanceof Response) return scope

      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        return fail(c, 400, 'bad_request', 'The body is not JSON')
      }

      const code = (body as { code?: unknown })?.code
      if (typeof code !== 'string' || !code) {
        return fail(c, 400, 'bad_request', 'No code to finish the authorization with')
      }

      const provider = registry.resolve(agentIdOf(c))
      await provider.completeMcpAuth(c.req.param('name'), code, scope)

      return ok(c, BffAcceptedResponseSchema, { accepted: true })
    }),
  )

  /**
   * Taking the authorization away.
   */
  app.delete('/:name/auth', (c) =>
    handle(c, async () => {
      const scope = await scopeOf(c, database)
      if (scope instanceof Response) return scope

      const provider = registry.resolve(agentIdOf(c))
      await provider.removeMcpAuth(c.req.param('name'), scope)

      return ok(c, BffAcceptedResponseSchema, { accepted: true })
    }),
  )

  return app
}

/**
 * Where a change to a tool server lands.
 *
 * A change that lands in a working directory belongs to the person who owns
 * that directory, so a directory that is not theirs is refused.
 *
 * A change with no working directory is a change to the server as a whole -
 * to every conversation on the host - and that is the administrator's
 * business. So without a directory, only the administrator may make one.
 */
async function scopeOf(
  c: McpContext,
  database: Database,
): Promise<{ directory?: string } | Response> {
  const principal = principalFrom(c.get('user'))
  const roots = resolveAccessRoots(database, principal)

  if (directoriesOf(c).length === 0) {
    if (!principalIsAdmin(principal)) {
      return fail(
        c,
        403,
        'forbidden',
        'Only an administrator may change a tool server for everybody',
      )
    }
    return {}
  }

  const checked = checkedDirectoriesOf(c, principal, roots)
  if (checked instanceof Response) return checked

  return checked[0] ? { directory: checked[0] } : {}
}
