import { Hono } from 'hono'
import { AgentListResponseSchema } from '@opencode-manager/shared/api/v1'
import type { ProviderRegistry } from '../../providers/registry'
import { handle, ok } from './respond'

export function createAgentRoutes(registry: ProviderRegistry) {
  const app = new Hono()

  app.get('/', (c) =>
    handle(c, async () => {
      const agents = await Promise.all(
        registry.list().map(async (provider) => ({
          id: provider.id,
          label: provider.label,
          kind: provider.kind,
          capabilities: [...provider.capabilities],
          status: (await provider.status()).status,
        })),
      )
      return ok(c, AgentListResponseSchema, { agents })
    }),
  )

  return app
}
