import { describe, expect, it } from 'vitest'
import { ProviderRegistry } from './registry'
import { AgentNotFoundError } from './contract'
import { FakeAgentProvider } from '../../test/helpers/fake-agent-provider'

describe('谁在 answering', () => {
  it('第一个登记的是默认的那个', () => {
    const registry = new ProviderRegistry()
    registry.register(new FakeAgentProvider({ id: 'alpha' }))
    registry.register(new FakeAgentProvider({ id: 'beta' }))

    expect(registry.defaultAgentId).toBe('alpha')
    expect(registry.resolve().id).toBe('alpha')
  })

  it('点名的那个就是点名的那个', () => {
    const registry = new ProviderRegistry()
    registry.register(new FakeAgentProvider({ id: 'alpha' }))
    registry.register(new FakeAgentProvider({ id: 'beta' }))

    expect(registry.resolve('beta').id).toBe('beta')
  })

  it('点一个不存在的，就是不存在的', () => {
    const registry = new ProviderRegistry()
    registry.register(new FakeAgentProvider({ id: 'alpha' }))

    expect(() => registry.resolve('gamma')).toThrow(AgentNotFoundError)
  })

  it('登记过的都在名单上', () => {
    const registry = new ProviderRegistry()
    registry.register(new FakeAgentProvider({ id: 'alpha' }))
    registry.register(new FakeAgentProvider({ id: 'beta' }))

    expect(registry.list().map((provider) => provider.id)).toEqual(['alpha', 'beta'])
  })
})
