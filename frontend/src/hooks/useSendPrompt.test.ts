import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { useSendPrompt } from './useOpenCode'
import { FetchError } from '../api/fetchWrapper'
import { messagesQueryKey } from '../lib/queryInvalidation'
import { providersQueryKey, type ProvidersResult } from '../api/providers'
import { ProviderSchema } from '@opencode-manager/shared/api/v1'

/**
 * A catalogue, in the layer's own words.
 *
 * The shape is checked with the layer's own schema, so a fixture written in
 * the old dialect - the models as a dictionary - is a failing test rather
 * than a passing one. The check that asks whether a picked model is still
 * available used to read such a dictionary while the catalogue's models are
 * a list, and it refused every prompt sent with a model.
 */
function catalogueOf(providers: unknown[]): ProvidersResult {
  const parsed = ProviderSchema.array().parse(providers)
  return {
    providers: parsed,
    connected: parsed.filter((provider) => provider.connected).map((provider) => provider.id),
    default: {},
  }
}

const mockSendPrompt = vi.fn()
const mockSetOptimisticActive = vi.fn()
const mockClearStatus = vi.fn()

vi.mock('../api/bff', async () => {
  const actual = await vi.importActual('../api/bff')
  return {
    ...actual,
    createBffClient: vi.fn(() => ({
      sendPrompt: mockSendPrompt,
    })),
  }
})

vi.mock('@/stores/sessionStatusStore', () => ({
  useSessionStatus: Object.assign(vi.fn(() => vi.fn()), {
    getState: () => ({
      setOptimisticActive: mockSetOptimisticActive,
      clearStatus: mockClearStatus,
    }),
  }),
}))

vi.mock('../lib/toast', () => ({
  showToast: { error: vi.fn() },
}))

vi.mock('../lib/opencode-errors', () => ({
  parseNetworkError: vi.fn((err) => ({
    title: 'Error',
    message: err.message,
    isRetryable: false,
  })),
  isGatewayTimeout: vi.fn((err) => err?.statusCode === 524),
}))

const mockClearError = vi.fn()
const mockSetError = vi.fn()
const mockSetQueuedPrompt = vi.fn()
const mockClearQueuedPrompt = vi.fn()
const mockFailQueuedPrompt = vi.fn()

vi.mock('../stores/sendErrorStore', () => ({
  useSendErrorStore: {
    getState: () => ({
      clearError: mockClearError,
      setError: mockSetError,
      setQueuedPrompt: mockSetQueuedPrompt,
      clearQueuedPrompt: mockClearQueuedPrompt,
      failQueuedPrompt: mockFailQueuedPrompt,
      getError: vi.fn(),
    }),
  },
}))

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

describe('useSendPrompt', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = createTestQueryClient()
    mockSendPrompt.mockResolvedValue(undefined)
  })

  const renderHookWithProviders = () =>
    renderHook(
      // The layer the client talks to, and the working directory.
      () => useSendPrompt('http://localhost:5551', '/test'),
      {
        wrapper: ({ children }) =>
          createElement(QueryClientProvider, { client: queryClient }, children),
      }
    )

  it('proceeds when no providers in cache', async () => {
    const { result } = renderHookWithProviders()

    await expect(
      result.current.mutateAsync({
        sessionID: 'test-session',
        prompt: 'Hello',
        model: 'anthropic/claude-sonnet-4',
      })
    ).resolves.toBeUndefined()

    expect(mockSendPrompt).toHaveBeenCalledWith(
      'test-session',
      expect.objectContaining({ parts: expect.any(Array) }),
      ['/test'],
    )
  })

  it('throws FetchError with MODEL_UNAVAILABLE when model not in providers', async () => {
    queryClient.setQueryData(
      providersQueryKey('/test'),
      catalogueOf([
        {
          id: 'openai',
          name: 'OpenAI',
          env: [],
          models: [
            {
              id: 'gpt-4',
              name: 'GPT-4',
              limit: null,
              cost: null,
              capabilities: null,
              modalities: null,
              variants: null,
            },
          ],
          connected: true,
        },
      ]),
    )

    const { result } = renderHookWithProviders()

    let error: Error | undefined
    try {
      await result.current.mutateAsync({
        sessionID: 'test-session',
        prompt: 'Hello',
        model: 'anthropic/claude-sonnet-4',
      })
    } catch (e) {
      error = e as Error
    }

    expect(error).toBeInstanceOf(FetchError)
    expect((error as FetchError).code).toBe('MODEL_UNAVAILABLE')
    expect((error as FetchError).statusCode).toBe(409)
    expect(error!.message).toBe('Selected model is no longer available. Pick a different model.')
    expect(mockSendPrompt).not.toHaveBeenCalled()
  })

  it('proceeds when model exists in providers', async () => {
    queryClient.setQueryData(
      providersQueryKey('/test'),
      catalogueOf([
        {
          id: 'anthropic',
          name: 'Anthropic',
          env: [],
          models: [
            {
              id: 'claude-sonnet-4',
              name: 'Claude Sonnet 4',
              limit: null,
              cost: null,
              capabilities: null,
              modalities: null,
              variants: null,
            },
          ],
          connected: true,
        },
      ]),
    )

    const { result } = renderHookWithProviders()

    await expect(
      result.current.mutateAsync({
        sessionID: 'test-session',
        prompt: 'Hello',
        model: 'anthropic/claude-sonnet-4',
      })
    ).resolves.toBeUndefined()

    expect(mockSendPrompt).toHaveBeenCalledWith(
      'test-session',
      expect.objectContaining({
        parts: expect.any(Array),
        model: { providerId: 'anthropic', modelId: 'claude-sonnet-4' },
      }),
      ['/test'],
    )
  })

  it('clears stored send error on successful send', async () => {
    mockClearError.mockClear()

    const { result } = renderHookWithProviders()

    await expect(
      result.current.mutateAsync({
        sessionID: 'session-1',
        prompt: 'Hello',
      })
    ).resolves.toBeUndefined()

    expect(mockClearError).toHaveBeenCalledWith('session-1')
  })

  it('stores the raw prompt for restoration when parts omit file mentions', async () => {
    const { result } = renderHookWithProviders()

    await expect(
      result.current.mutateAsync({
        sessionID: 'session-raw',
        prompt: 'please inspect @App.tsx',
        parts: [
          { type: 'text', content: 'please inspect ' },
          { type: 'file', path: '/repo/src/App.tsx', name: 'App.tsx' },
        ],
      })
    ).resolves.toBeUndefined()

    expect(mockSetQueuedPrompt).toHaveBeenCalledWith('session-raw', 'please inspect @App.tsx')
  })

  it('stores queued prompt before the async request resolves', async () => {
    let resolveAsync: () => void = () => {}
    mockSendPrompt.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveAsync = resolve
    }))

    const { result } = renderHookWithProviders()

    const pending = result.current.mutateAsync({
      sessionID: 'session-pending',
      prompt: 'pending queued prompt',
    })

    await waitFor(() => {
      expect(mockSetQueuedPrompt).toHaveBeenCalledWith('session-pending', 'pending queued prompt')
    })

    resolveAsync()
    await expect(pending).resolves.toBeUndefined()
  })

  it('clears queued prompt and stores failed prompt on network failure', async () => {
    const queryKey = messagesQueryKey('http://localhost:5551', 'session-lost', '/test')
    queryClient.setQueryData(queryKey, [
      { info: { id: 'optimistic_user_1' }, parts: [] },
    ])
    mockSendPrompt.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const { result } = renderHookWithProviders()

    await expect(
      result.current.mutateAsync({
        sessionID: 'session-lost',
        prompt: 'keep this prompt',
      })
    ).rejects.toThrow('Failed to fetch')

    expect(mockClearQueuedPrompt).toHaveBeenCalledWith('session-lost')
    expect(mockClearStatus).toHaveBeenCalledWith('session-lost')
    expect(mockSetError).toHaveBeenCalledWith(expect.objectContaining({
      sessionID: 'session-lost',
      failedPrompt: 'keep this prompt',
      kind: 'network',
    }))
    expect(queryClient.getQueryData(queryKey)).toEqual([])
  })

  it('surfaces no error on gateway timeout (524)', async () => {
    const queryKey = messagesQueryKey('http://localhost:5551', 'session-524', '/test')
    queryClient.setQueryData(queryKey, [
      { info: { id: 'optimistic_user_1' }, parts: [] },
    ])
    mockSendPrompt.mockRejectedValueOnce(new FetchError('Gateway timeout', 524))

    const { result } = renderHookWithProviders()

    await expect(
      result.current.mutateAsync({
        sessionID: 'session-524',
        prompt: 'long running prompt',
      })
    ).rejects.toThrow('Gateway timeout')

    expect(queryClient.getQueryData(queryKey)).toEqual([])
    expect(mockClearStatus).not.toHaveBeenCalled()
    expect(mockSetError).not.toHaveBeenCalled()
  })

  it('invalidates the messages query on success', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const sessionID = 'session-invalidate'

    const { result } = renderHookWithProviders()

    await expect(
      result.current.mutateAsync({
        sessionID,
        prompt: 'Hello',
      })
    ).resolves.toBeUndefined()

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: messagesQueryKey('http://localhost:5551', sessionID, '/test'),
    })
  })
})
