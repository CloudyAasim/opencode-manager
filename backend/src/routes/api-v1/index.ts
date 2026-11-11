import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { ApiDescriptorSchema } from '@opencode-manager/shared/api/v1'
import type { AuthInstance, Session } from '../../auth'
import { createAuthMiddleware } from '../../auth/middleware'
import type { ProviderRegistry } from '../../providers/registry'
import { createAgentRoutes } from './agents'
import { createSessionRoutes } from './sessions'
import { createPendingRoutes } from './pending'
import { fail, handle, ok } from './respond'

export interface ApiV1Options {
  name: string
  version: () => Promise<string>
  auth: AuthInstance
}

export function createApiV1Routes(registry: ProviderRegistry, database: Database, options: ApiV1Options) {
  const app = new Hono<{ Variables: { session: Session['session']; user: Session['user'] } }>()

  // The gate is the same gate the rest of the server uses - one session, or
  // no session - but it answers in this API's shape. A client that reads
  // `error.code` must not find a string where an object should be, least of
  // all on the one answer every client meets first.
  app.use(
    '/*',
    createAuthMiddleware(options.auth, {
      unauthorized: (c) => fail(c, 401, 'unauthorized', 'No session'),
      internalError: (c) => fail(c, 500, 'internal_error', 'Something went wrong'),
    }),
  )

  app.get('/', (c) =>
    handle(c, async () =>
      ok(c, ApiDescriptorSchema, {
        api: 'v1',
        name: options.name,
        version: await options.version(),
        defaultAgent: registry.defaultAgentId,
      }),
    ),
  )

  app.route('/agents', createAgentRoutes(registry))
  app.route('/sessions', createSessionRoutes(registry, database))
  app.route('/pending', createPendingRoutes(registry, database))

  return app
}
