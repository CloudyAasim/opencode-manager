import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useProvidersWithModels } from './useProvidersWithModels'

vi.mock('@/api/providers', () => ({
  getProvidersWithModels: vi.fn(async () => []),
}))
vi.mock('@/hooks/useOpenCodeConfigFile', () => ({
  useOpenCodeConfigFile: () => ({ data: undefined, isLoading: false }),
}))

/**
 * The cached answer depends on the directory - getProviders() sends it to the
 * server - so it has to be part of the key. It was not, which meant whichever
 * project's models arrived first in the cache answered for every other one.
 */
describe('模型列表的缓存键', () => {
  let client: QueryClient

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  it('不同目录各自一份，不会互相顶替', () => {
    const { rerender } = renderHook(
      ({ directory }: { directory: string }) =>
        useProvidersWithModels({ enabled: false, directory }),
      { initialProps: { directory: '/repo-a' }, wrapper },
    )

    rerender({ directory: '/repo-b' })
    rerender({ directory: '/repo-a' })

    const keys = client
      .getQueryCache()
      .findAll({ queryKey: ['providers-with-models'] })
      .map((query) => query.queryKey.join('|'))

    expect(keys.some((key) => key.includes('/repo-a'))).toBe(true)
    expect(keys.some((key) => key.includes('/repo-b'))).toBe(true)
  })

  it('没有目录时也能区分', () => {
    renderHook(() => useProvidersWithModels({ enabled: false }), { wrapper })
    const keys = client
      .getQueryCache()
      .findAll({ queryKey: ['providers-with-models'] })
      .map((query) => query.queryKey)

    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      expect(Array.isArray(key)).toBe(true)
    }
  })
})
