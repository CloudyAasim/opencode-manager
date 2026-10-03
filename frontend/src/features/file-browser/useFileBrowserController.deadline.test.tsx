import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFileBrowserController } from './useFileBrowserController'

vi.mock('@/hooks/useMobile', () => ({ useMobile: () => false }))
vi.mock('@/api/files', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/files')>()
  return {
    ...actual,
    getFileApiUrl: (path: string) => `/api/files?path=${encodeURIComponent(path)}`,
  }
})

/**
 * The listing was fetched with a bare `fetch` and no deadline. When the server
 * refused the workspace path the screen kept spinning for ever instead of
 * showing the refusal - which is what /files did on the deployed site for an
 * account with no workspace.
 */
describe('文件列表请求有截止时间', () => {
  const realFetch = globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    globalThis.fetch = realFetch
  })

  it('给 fetch 传了一个 signal，而不是裸奔', async () => {
    // A promise that never settles - the exact shape that left the spinner up.
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetchMock)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    renderHook(() => useFileBrowserController({ basePath: '' }), { wrapper })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    expect(init?.signal, '没有 signal，这个请求可以永远挂着').toBeDefined()
  })
})
