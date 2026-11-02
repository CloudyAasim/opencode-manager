import { AgentNotFoundError, type AgentProvider } from './contract'

/**
 * Which agent answers when nobody says. The registry is the one place that
 * knows a concrete agent id, so the versioned API can stay ignorant of it.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, AgentProvider>()
  private fallbackId: string | null = null

  register(provider: AgentProvider, options: { default?: boolean } = {}): void {
    this.providers.set(provider.id, provider)
    if (options.default || this.fallbackId === null) {
      this.fallbackId = provider.id
    }
  }

  list(): AgentProvider[] {
    return [...this.providers.values()]
  }

  get defaultProvider(): AgentProvider | null {
    if (!this.fallbackId) return null
    return this.providers.get(this.fallbackId) ?? null
  }

  get defaultAgentId(): string | null {
    return this.fallbackId
  }

  resolve(agentId?: string | null): AgentProvider {
    if (agentId) {
      const provider = this.providers.get(agentId)
      if (!provider) throw new AgentNotFoundError(agentId)
      return provider
    }

    const fallback = this.defaultProvider
    if (!fallback) throw new AgentNotFoundError('*')
    return fallback
  }
}
