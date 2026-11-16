import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useModelSelection } from './useModelSelection'
import { useModelStore, type ModelSelection } from '@/stores/modelStore'
import * as useOpenCodeExports from './useOpenCode'
import * as providersApi from '@/api/providers'
import type { Model } from '@/api/providers'

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

vi.mock('./useOpenCode', async () => {
  const actual = await vi.importActual('./useOpenCode')
  return {
    ...actual,
    useAgentDefaults: vi.fn(),
  }
})

vi.mock('@/api/providers', async () => {
  const actual = await vi.importActual('@/api/providers')
  return {
    ...actual,
    getProviders: vi.fn(),
    getOpenCodeModelState: vi.fn(),
    addOpenCodeRecentModel: vi.fn(),
    removeOpenCodeRecentModel: vi.fn(),
    toggleOpenCodeFavoriteModel: vi.fn(),
  }
})

const mockUseAgentDefaults = vi.mocked(useOpenCodeExports.useAgentDefaults)
const mockGetProviders = vi.mocked(providersApi.getProviders)
const mockGetOpenCodeModelState = vi.mocked(providersApi.getOpenCodeModelState)
const mockAddOpenCodeRecentModel = vi.mocked(providersApi.addOpenCodeRecentModel)
const mockRemoveOpenCodeRecentModel = vi.mocked(providersApi.removeOpenCodeRecentModel)
const mockToggleOpenCodeFavoriteModel = vi.mocked(providersApi.toggleOpenCodeFavoriteModel)

/**
 * A model, in the versioned dialect.
 *
 * The catalogue says more about a model than this, and all of that may be
 * unknown - which is what null means. A test that only cares about the name
 * says so.
 */
function makeModel(id: string, name: string): Model {
  return {
    id,
    name,
    limit: null,
    cost: null,
    capabilities: null,
    modalities: null,
    variants: null,
  }
}

describe('useModelSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useModelStore.getState().setModel({ providerID: 'test', modelID: 'test-model' })
    useModelStore.getState().setActiveModel({ providerID: 'test', modelID: 'test-model' })
    
    mockUseAgentDefaults.mockReturnValue({ data: undefined, isLoading: false } as any)
    mockGetProviders.mockResolvedValue({
      providers: [],
      connected: [],
      default: {},
    })
    mockGetOpenCodeModelState.mockResolvedValue({
      recent: [],
      favorite: [],
      variant: {},
    })
    mockAddOpenCodeRecentModel.mockResolvedValue({
      recent: [],
      favorite: [],
      variant: {},
    })
    mockRemoveOpenCodeRecentModel.mockResolvedValue({
      recent: [],
      favorite: [],
      variant: {},
    })
    mockToggleOpenCodeFavoriteModel.mockResolvedValue({
      recent: [],
      favorite: [],
      variant: {},
    })
  })

  const renderHookWithProviders = () => {
    const queryClient = createTestQueryClient()
    return renderHook(
      () => useModelSelection('http://localhost:5551', 'http://localhost:5551', '/test'),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        ),
      }
    )
  }

  it('does not restore before providers are loaded', async () => {
    mockGetProviders.mockImplementation(() => new Promise(() => {}))

    const { result } = renderHookWithProviders()

    const testModel: ModelSelection = { providerID: 'anthropic', modelID: 'claude-sonnet-4' }
    const returnValue = result.current.setActiveModel(testModel)

    expect(returnValue).toBe(false)
    expect(useModelStore.getState().model).not.toEqual(testModel)
  })

  it('restores when model exists in providers', async () => {
    const providersData = {
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: [makeModel('claude-sonnet-4', 'Claude Sonnet 4')],
          env: [],
          connected: true,
        },
      ],
      connected: ['anthropic'],
      default: {},
    }

    mockGetProviders.mockResolvedValue(providersData as any)

    const { result } = renderHookWithProviders()

    await waitFor(() => {
      expect(result.current).toBeDefined()
    })

    await waitFor(() => {
      expect(mockGetProviders).toHaveBeenCalled()
    })

    const testModel: ModelSelection = { providerID: 'anthropic', modelID: 'claude-sonnet-4' }
    const returnValue = result.current.setActiveModel(testModel)

    expect(returnValue).toBe(true)
    expect(useModelStore.getState().model).toEqual(testModel)
  })

  it('rejects unknown model after providers are loaded', async () => {
    const providersData = {
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: [makeModel('claude-sonnet-4', 'Claude Sonnet 4')],
          env: [],
          connected: true,
        },
      ],
      connected: ['anthropic'],
      default: {},
    }

    mockGetProviders.mockResolvedValue(providersData as any)

    const { result } = renderHookWithProviders()

    await waitFor(() => {
      expect(result.current).toBeDefined()
    })

    await waitFor(() => {
      expect(mockGetProviders).toHaveBeenCalled()
    })

    const initialModel = useModelStore.getState().model
    const testModel: ModelSelection = { providerID: 'anthropic', modelID: 'missing-model' }
    const returnValue = result.current.setActiveModel(testModel)

    expect(returnValue).toBe(false)
    expect(useModelStore.getState().model).toEqual(initialModel)
  })

  describe('recentModels/favoriteModels derived from React Query', () => {
    it('filters out models not present in providers', async () => {
      mockGetOpenCodeModelState.mockResolvedValue({
        recent: [
          { providerID: 'AI2', modelID: 'foo' },
          { providerID: 'GreatScott', modelID: 'mimo' },
        ],
        favorite: [
          { providerID: 'VLLM', modelID: 'bar' },
          { providerID: 'GreatScott', modelID: 'mimo' },
        ],
        variant: {},
      })
      mockGetProviders.mockResolvedValue({
        providers: [
          {
            id: 'AI2',
            name: 'AI2',
            models: [makeModel('foo', 'Foo')],
            env: [],
            connected: true,
          },
          {
            id: 'VLLM',
            name: 'VLLM',
            models: [makeModel('bar', 'Bar')],
            env: [],
            connected: true,
          },
        ],
        connected: ['AI2', 'VLLM'],
        default: {},
      } as any)

      const { result } = renderHookWithProviders()

      await waitFor(() => {
        expect(result.current.recentModels).toEqual([{ providerID: 'AI2', modelID: 'foo' }])
      })

      await waitFor(() => {
        expect(result.current.favoriteModels).toEqual([{ providerID: 'VLLM', modelID: 'bar' }])
      })
    })

    it('returns raw values when providers query is loading (undefined)', async () => {
      mockGetOpenCodeModelState.mockResolvedValue({
        recent: [{ providerID: 'AI2', modelID: 'foo' }],
        favorite: [{ providerID: 'VLLM', modelID: 'bar' }],
        variant: {},
      })
      mockGetProviders.mockImplementation(() => new Promise(() => {}))

      const { result } = renderHookWithProviders()

      await waitFor(() => {
        expect(result.current.recentModels).toEqual([{ providerID: 'AI2', modelID: 'foo' }])
      })

      expect(result.current.favoriteModels).toEqual([{ providerID: 'VLLM', modelID: 'bar' }])
    })

    it('returns raw values when providers returns empty array', async () => {
      mockGetOpenCodeModelState.mockResolvedValue({
        recent: [{ providerID: 'AI2', modelID: 'foo' }],
        favorite: [{ providerID: 'VLLM', modelID: 'bar' }],
        variant: {},
      })
      mockGetProviders.mockResolvedValue({
        providers: [],
        connected: [],
        default: {},
      } as any)

      const { result } = renderHookWithProviders()

      await waitFor(() => {
        expect(result.current.recentModels).toEqual([{ providerID: 'AI2', modelID: 'foo' }])
      })

      expect(result.current.favoriteModels).toEqual([{ providerID: 'VLLM', modelID: 'bar' }])
    })
  })

  describe('startup model resolution', () => {
    const providersData = {
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: [makeModel('claude-sonnet-4', 'Claude Sonnet 4'), makeModel('claude-opus-4', 'Claude Opus 4')],
          env: [],
          connected: true,
        },
        {
          id: 'openai',
          name: 'OpenAI',
          models: [makeModel('gpt-4o', 'GPT-4o')],
          env: [],
          connected: true,
        },
      ],
      connected: ['anthropic', 'openai'],
      default: { anthropic: 'claude-opus-4' },
    }

    it('prefers config model over recent and provider default', async () => {
      mockUseAgentDefaults.mockReturnValue({
        data: { model: { providerId: 'anthropic', modelId: 'claude-sonnet-4' }, workingMode: null },
        isLoading: false,
      } as any)
      mockGetProviders.mockResolvedValue(providersData as any)
      mockGetOpenCodeModelState.mockResolvedValue({
        recent: [{ providerID: 'openai', modelID: 'gpt-4o' }],
        favorite: [],
        variant: {},
      })

      const { result } = renderHookWithProviders()

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
      })
    })

    it('prefers recent model over provider default when config is missing', async () => {
      mockGetProviders.mockResolvedValue(providersData as any)
      mockGetOpenCodeModelState.mockResolvedValue({
        recent: [{ providerID: 'anthropic', modelID: 'claude-sonnet-4' }],
        favorite: [],
        variant: {},
      })

      const { result } = renderHookWithProviders()

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
      })
    })

    it('falls back to provider default when config and recent are unavailable', async () => {
      mockGetProviders.mockResolvedValue(providersData as any)

      const { result } = renderHookWithProviders()

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'anthropic', modelID: 'claude-opus-4' })
      })
    })
  })

  it('toggleFavorite calls toggleOpenCodeFavoriteModel and does not mutate Zustand', async () => {
    const { result } = renderHookWithProviders()

    await waitFor(() => {
      expect(result.current).toBeDefined()
    })

    const testModel: ModelSelection = { providerID: 'anthropic', modelID: 'claude-sonnet-4' }
    result.current.toggleFavorite(testModel)

    await waitFor(() => {
      expect(mockToggleOpenCodeFavoriteModel).toHaveBeenCalledTimes(1)
    })
    expect(mockToggleOpenCodeFavoriteModel.mock.calls[0][0]).toEqual(testModel)
    expect(useModelStore.getState().model).not.toEqual(testModel)
  })

  it('removes recent models optimistically and rolls back on failure', async () => {
    const removedModel: ModelSelection = { providerID: 'anthropic', modelID: 'claude-sonnet-4' }
    const retainedModel: ModelSelection = { providerID: 'openai', modelID: 'gpt-4.1' }
    let rejectRemove: (error: Error) => void = () => {}
    mockGetOpenCodeModelState.mockResolvedValue({
      recent: [removedModel, retainedModel],
      favorite: [],
      variant: {},
    })
    mockRemoveOpenCodeRecentModel.mockImplementation(() => new Promise((_, reject) => {
      rejectRemove = reject
    }))

    const { result } = renderHookWithProviders()

    await waitFor(() => {
      expect(result.current.recentModels).toEqual([removedModel, retainedModel])
    })

    act(() => {
      result.current.removeRecentModel(removedModel)
    })

    await waitFor(() => {
      expect(result.current.recentModels).toEqual([retainedModel])
    })

    act(() => {
      rejectRemove(new Error('remove failed'))
    })

    await waitFor(() => {
      expect(result.current.recentModels).toEqual([removedModel, retainedModel])
    })
  })

  it('user selection still updates recents', async () => {
    const providersData = {
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: [makeModel('claude-sonnet-4', 'Claude Sonnet 4')],
          env: [],
          connected: true,
        },
      ],
      connected: ['anthropic'],
      default: {},
    }

    mockGetProviders.mockResolvedValue(providersData as any)
    mockAddOpenCodeRecentModel.mockResolvedValue({
      recent: [{ providerID: 'anthropic', modelID: 'claude-sonnet-4' }],
      favorite: [],
      variant: {},
    })

    const { result } = renderHookWithProviders()

    await waitFor(() => {
      expect(result.current).toBeDefined()
    })

    await waitFor(() => {
      expect(mockGetProviders).toHaveBeenCalled()
    })

    const testModel: ModelSelection = { providerID: 'anthropic', modelID: 'claude-sonnet-4' }
    result.current.setModel(testModel)

    expect(useModelStore.getState().model).toEqual(testModel)
    await waitFor(() => {
      expect(mockAddOpenCodeRecentModel).toHaveBeenCalled()
      expect(mockAddOpenCodeRecentModel.mock.calls[0][0]).toEqual(testModel)
    })

    await waitFor(() => {
      expect(mockAddOpenCodeRecentModel).toHaveBeenCalledTimes(1)
    })
  })

  it('restoreSessionModel sets model without requiring providers', async () => {
    mockGetProviders.mockImplementation(() => new Promise(() => {}))

    const { result } = renderHookWithProviders()

    const sessionModel: ModelSelection = { providerID: 'anthropic', modelID: 'claude-sonnet-4' }
    result.current.restoreSessionModel(sessionModel)

    expect(useModelStore.getState().model).toEqual(sessionModel)
  })
})
