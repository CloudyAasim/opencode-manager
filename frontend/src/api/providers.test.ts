import { describe, it, expect, vi, beforeEach } from 'vitest'
import { findProvider, getProvidersWithModels } from './providers'
import { makeOpenCodeConfigFile } from '@/test/fixtures/opencode-config'

const { mockGetConfiguration, mockFetchWrapper } = vi.hoisted(() => ({
  mockGetConfiguration: vi.fn(),
  mockFetchWrapper: vi.fn(),
}))

vi.mock('./config', () => ({
  configApi: {
    getConfiguration: mockGetConfiguration,
  },
}))

vi.mock('./fetchWrapper', () => ({
  fetchWrapper: mockFetchWrapper,
}))

const config = makeOpenCodeConfigFile({
  content: {
    provider: {
      openai: {
        name: 'OpenAI',
        models: {
          'gpt-4o': { name: 'GPT-4o' },
        },
      },
    },
  },
})

describe('getProvidersWithModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The catalogue arrives from the layer the client talks to, in the
    // versioned dialect: the providers, and the model each one starts on.
    mockFetchWrapper.mockResolvedValue({ providers: [], default: {} })
  })

  it('uses the supplied config instead of re-reading it', async () => {
    const providers = await getProvidersWithModels(undefined, config)

    expect(mockGetConfiguration).not.toHaveBeenCalled()
    expect(providers.map((provider) => provider.id)).toEqual(['openai'])
  })

  it('reads the config when none is supplied', async () => {
    mockGetConfiguration.mockResolvedValue(config)

    const providers = await getProvidersWithModels(undefined)

    expect(mockGetConfiguration).toHaveBeenCalledTimes(1)
    expect(providers.map((provider) => provider.id)).toEqual(['openai'])
  })

  it('degrades to no configured providers when the config read fails', async () => {
    mockGetConfiguration.mockRejectedValue(new Error('no config file'))

    const providers = await getProvidersWithModels(undefined)

    expect(providers).toEqual([])
  })

  it('the catalogue is asked of the layer, in the versioned dialect', async () => {
    mockFetchWrapper.mockResolvedValue({
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          env: [],
          models: [
            {
              id: 'claude-sonnet-4',
              name: 'Claude Sonnet 4',
              limit: { context: 200000, output: 64000 },
              cost: null,
              capabilities: null,
              modalities: null,
              variants: null,
            },
          ],
          connected: true,
        },
      ],
      default: { anthropic: 'claude-sonnet-4' },
    })

    const providers = await getProvidersWithModels(undefined, config)

    const anthropic = findProvider(providers, 'anthropic')
    expect(anthropic?.source).toBe('builtin')
    expect(anthropic?.connected).toBe(true)
    expect(anthropic?.models.map((model) => model.id)).toEqual(['claude-sonnet-4'])

    // The catalogue is asked of the layer, not of the agent.
    const asked = String(mockFetchWrapper.mock.calls[0]?.[0] ?? '')
    expect(asked).toContain('/api/bff/providers')
  })
})
