import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import type { AuthInstance, Session } from '../../auth'
import { createAuthMiddleware } from '../../auth/middleware'
import type { ProviderRegistry } from '../../providers/registry'
import { createBffSessionRoutes } from './sessions'
import { createBffPendingRoutes } from './pending'
import { createBffStatusRoutes } from './status'
import { createBffCommandRoutes } from './commands'
import { createBffWorkingModeRoutes } from './working-modes'
import { createBffDefaultRoutes } from './defaults'
import { createBffProviderRoutes } from './providers'
import { createBffFileRoutes } from './files'
import { createBffMcpRoutes } from './mcp'
import { createBffProviderAuthRoutes } from './provider-auth'
import { createBffConfigurationRoutes } from './config'
import { fail } from '../api-v1/respond'

/**
 * The layer the web client talks to.
 *
 * The client is not the versioned API's audience. That one speaks to native
 * clients, one agent and one working directory at a time, and it is meant to
 * stay still while those clients change. The web client wants something
 * else: the list of a person's conversations across every directory they
 * work in, in one answer, and it wants it without knowing which agent is
 * behind it.
 *
 * So the client talks to this, and this talks to the versioned API's layer
 * underneath. The client never reaches for `/api/v1` itself - a client that
 * did would be coupled to a contract that is explicitly allowed to move, and
 * the whole point of the layer in between would be to have been pointless.
 *
 * The error envelope is the versioned API's, on purpose. There is one way
 * this server says no, and a client that has to understand two of them has
 * to understand one of them twice.
 */
export interface BffOptions {
  auth: AuthInstance
  /**
   * What has to happen once a provider has been logged in to.
   *
   * The credential is in the hands of the agent, and the agent is kept running
   * by the manager - so the manager is the one that says what has to happen
   * afterwards. The layer only says that it is done.
   */
  afterAuthorization?: () => Promise<void>
}

export function createBffRoutes(registry: ProviderRegistry, database: Database, options: BffOptions) {
  const app = new Hono<{ Variables: { session: Session['session']; user: Session['user'] } }>()

  // The same session rule the rest of the server uses - one session, or no
  // session - answering in the same envelope. This layer is mounted behind
  // the protected API, so this gate is the second one and not the only one;
  // it is here so that the layer does not depend on where it was mounted.
  app.use(
    '/*',
    createAuthMiddleware(options.auth, {
      unauthorized: (c) => fail(c, 401, 'unauthorized', 'No session'),
      internalError: (c) => fail(c, 500, 'internal_error', 'Something went wrong'),
    }),
  )

  app.route('/sessions', createBffSessionRoutes(registry, database))
  app.route('/pending', createBffPendingRoutes(registry, database))
  app.route('/status', createBffStatusRoutes(registry, database))
  app.route('/commands', createBffCommandRoutes(registry, database))
  app.route('/working-modes', createBffWorkingModeRoutes(registry, database))
  app.route('/defaults', createBffDefaultRoutes(registry, database))
  app.route('/providers', createBffProviderRoutes(registry, database))
  app.route('/files', createBffFileRoutes(registry, database))
  app.route('/mcp', createBffMcpRoutes(registry, database))
  app.route('/provider-auth', createBffProviderAuthRoutes(registry, options.afterAuthorization))
  app.route('/config', createBffConfigurationRoutes(registry, database))

  return app
}
