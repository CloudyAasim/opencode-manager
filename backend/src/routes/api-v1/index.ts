import { Hono } from 'hono'
import { ApiDescriptorSchema } from '@opencode-manager/shared/api/v1'
import type { ProviderRegistry } from '../../providers/registry'
import { createAgentRoutes } from './agents'
import { createSessionRoutes } from './sessions'
import { handle, ok } from './respond'

export interface ApiV1Options {
  name: string
  version: () => Promise<string>
}

export function createApiV1Routes(registry: ProviderRegistry, options: ApiV1Options) {
  const app = new Hono()

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
  app.route('/sessions', createSessionRoutes(registry))

  return app
}
