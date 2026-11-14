import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useSessionAgent, resolveDefaultSessionAgent } from './useSessionAgent'
import { useMessages, useAgentDefaults, useWorkingModes } from './useOpenCode'
import { useSessionAgentStore } from '../stores/sessionAgentStore'
import type { WorkingMode, WorkingModeScope } from '@opencode-manager/shared/api/v1'

const sessionAgentStoreMock = vi.hoisted(() => {
  const state = {
    agents: {} as Record<string, string>,
    setAgent: (sessionID: string, agent: string) => {
      state.agents = { ...state.agents, [sessionID]: agent }
    },
    getAgent: (sessionID: string) => state.agents[sessionID] ?? null,
  }

  const store = Object.assign(
    vi.fn((selector: (value: typeof state) => unknown) => selector(state)),
    {
      getState: () => state,
      setState: (nextState: Partial<typeof state>) => {
        Object.assign(state, nextState)
      },
    }
  )

  return { state, store }
})

vi.mock('./useOpenCode', () => ({
  useMessages: vi.fn(),
  useAgentDefaults: vi.fn(),
  useWorkingModes: vi.fn(),
}))

vi.mock('@/stores/sessionAgentStore', () => ({
  useSessionAgentStore: sessionAgentStoreMock.store,
}))

/**
 * A way of working, in the words the versioned API uses.
 *
 * The old shape said "mode" and the new one says "scope", and the old one had
 * no model at all - so the helper is here to keep the tests about which way of
 * working wins, not about how a way of working is spelled.
 */
const mode = (
  name: string,
  scope: WorkingModeScope = 'primary',
  hidden = false,
): WorkingMode => ({
  name,
  description: null,
  scope,
  hidden,
  color: null,
  model: null,
})

const defaults = (workingMode: string | null) => ({ model: null, workingMode })

beforeEach(() => {
  vi.clearAllMocks()
  sessionAgentStoreMock.store.setState({ agents: {} })
})

describe('resolveDefaultSessionAgent', () => {
  it('returns the default working mode when present and working modes not loaded', () => {
    const result = resolveDefaultSessionAgent('code', undefined, false)
    expect(result).toBe('code')
  })

  it('returns the default working mode when present and it is in visible primary ways', () => {
    const agents = [mode('code'), mode('build')]
    const result = resolveDefaultSessionAgent('code', agents, true)
    expect(result).toBe('code')
  })

  it('returns the default working mode case-insensitively when in primary ways', () => {
    const agents = [mode('Code')]
    const result = resolveDefaultSessionAgent('code', agents, true)
    expect(result).toBe('Code')
  })

  it('returns first visible primary/all way of working when there is no default', () => {
    const agents = [mode('assistant'), mode('code', 'all')]
    const result = resolveDefaultSessionAgent(undefined, agents, true)
    expect(result).toBe('assistant')
  })

  it('ignores hidden ways of working as fallback candidates', () => {
    const agents = [mode('hidden-agent', 'primary', true), mode('build')]
    const result = resolveDefaultSessionAgent(undefined, agents, true)
    expect(result).toBe('build')
  })

  it('ignores ways of working that cannot lead a conversation', () => {
    const agents = [mode('sub-agent', 'secondary' as WorkingModeScope), mode('build')]
    const result = resolveDefaultSessionAgent(undefined, agents, true)
    expect(result).toBe('build')
  })

  it('falls back to build only when no default and no primary way of working available', () => {
    const result = resolveDefaultSessionAgent(undefined, undefined, false)
    expect(result).toBe('build')
  })

  it('falls back to first visible primary way when the default is unavailable and ways are loaded', () => {
    const agents = [mode('code')]
    const result = resolveDefaultSessionAgent('missing-agent', agents, true)
    expect(result).toBe('code')
  })

  it('returns assistant when the assistant workspace defaults to assistant', () => {
    const agents = [mode('assistant')]
    const result = resolveDefaultSessionAgent('assistant', agents, true)
    expect(result).toBe('assistant')
  })
})

describe('useSessionAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSessionAgentStore.setState({ agents: {} })
  })

  it('returns the default way of working for empty loaded messages with stale store build', async () => {
    vi.mocked(useMessages).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useMessages>)
    vi.mocked(useAgentDefaults).mockReturnValue({
      data: defaults('code'),
    } as ReturnType<typeof useAgentDefaults>)
    vi.mocked(useWorkingModes).mockReturnValue({
      data: [mode('code'), mode('assistant')],
      isSuccess: true,
    } as ReturnType<typeof useWorkingModes>)

    const { result } = renderHook(() =>
      useSessionAgent('http://localhost:5551', 'session-1', '/assistant')
    )

    await waitFor(() => {
      expect(result.current.agent).toBe('code')
    })
  })

  it('returns message-derived way of working when latest user message has one', async () => {
    const messagesData = [
      {
        info: {
          role: 'user',
          agent: 'assistant',
          providerId: 'provider',
          modelId: 'model',
          variant: 'variant-1',
        },
      },
    ]
    vi.mocked(useMessages).mockReturnValue({
      data: messagesData,
      isLoading: false,
    } as ReturnType<typeof useMessages>)
    vi.mocked(useAgentDefaults).mockReturnValue({
      data: defaults('code'),
    } as ReturnType<typeof useAgentDefaults>)
    vi.mocked(useWorkingModes).mockReturnValue({
      data: [mode('code'), mode('assistant')],
      isSuccess: true,
    } as ReturnType<typeof useWorkingModes>)

    const { result } = renderHook(() =>
      useSessionAgent('http://localhost:5551', 'session-1', '/assistant')
    )

    await waitFor(() => {
      expect(result.current.agent).toBe('assistant')
      expect(result.current.model).toEqual({ providerID: 'provider', modelID: 'model' })
      expect(result.current.variant).toBe('variant-1')
    })
  })

  it('keeps the cached conversation selection while messages refetch in the background', async () => {
    vi.mocked(useMessages).mockReturnValue({
      data: [
        {
          info: {
            role: 'user',
            agent: 'assistant',
            providerId: 'provider',
          modelId: 'session-model',
            variant: 'session-variant',
          },
        },
      ],
      isLoading: false,
      isFetching: true,
    } as ReturnType<typeof useMessages>)
    vi.mocked(useAgentDefaults).mockReturnValue({
      data: defaults('code'),
    } as ReturnType<typeof useAgentDefaults>)
    vi.mocked(useWorkingModes).mockReturnValue({
      data: [mode('code'), mode('assistant')],
      isSuccess: true,
    } as ReturnType<typeof useWorkingModes>)

    const { result } = renderHook(() =>
      useSessionAgent('http://localhost:5551', 'session-1', '/assistant')
    )

    await waitFor(() => {
      expect(result.current.agent).toBe('assistant')
      expect(result.current.model).toEqual({ providerID: 'provider', modelID: 'session-model' })
      expect(result.current.variant).toBe('session-variant')
    })
  })

  it('falls back to the stored session way of working instead of the default while messages load', async () => {
    useSessionAgentStore.setState({ agents: { 'session-1': 'assistant' } })
    vi.mocked(useMessages).mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
    } as ReturnType<typeof useMessages>)
    vi.mocked(useAgentDefaults).mockReturnValue({
      data: defaults('code'),
    } as ReturnType<typeof useAgentDefaults>)
    vi.mocked(useWorkingModes).mockReturnValue({
      data: [mode('code'), mode('assistant')],
      isSuccess: true,
    } as ReturnType<typeof useWorkingModes>)

    const { result } = renderHook(() =>
      useSessionAgent('http://localhost:5551', 'session-1', '/assistant')
    )

    await waitFor(() => {
      expect(result.current.agent).toBe('assistant')
    })
  })

  it('does not persist default way-of-working fallback to store', async () => {
    vi.mocked(useMessages).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useMessages>)
    vi.mocked(useAgentDefaults).mockReturnValue({
      data: defaults('code'),
    } as ReturnType<typeof useAgentDefaults>)
    vi.mocked(useWorkingModes).mockReturnValue({
      data: [mode('code')],
      isSuccess: true,
    } as ReturnType<typeof useWorkingModes>)

    renderHook(() =>
      useSessionAgent('http://localhost:5551', 'session-1', '/assistant')
    )

    await waitFor(() => {
      const storeState = useSessionAgentStore.getState()
      expect(storeState.agents['session-1']).toBeUndefined()
    })
  })

  it('ignores stale stored way of working when unavailable in loaded primary ways', async () => {
    useSessionAgentStore.setState({ agents: { 'session-1': 'build' } })
    vi.mocked(useMessages).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useMessages>)
    vi.mocked(useAgentDefaults).mockReturnValue({
      data: defaults('code'),
    } as ReturnType<typeof useAgentDefaults>)
    vi.mocked(useWorkingModes).mockReturnValue({
      data: [mode('code'), mode('architect')],
      isSuccess: true,
    } as ReturnType<typeof useWorkingModes>)

    const { result } = renderHook(() =>
      useSessionAgent('http://localhost:5551', 'session-1', '/assistant')
    )

    await waitFor(() => {
      expect(result.current.agent).toBe('code')
    })
  })

  it('uses latest message way of working only when it is available in loaded primary ways', async () => {
    vi.mocked(useMessages).mockReturnValue({
      data: [
        {
          info: {
            role: 'user',
            agent: 'build',
          },
        },
      ],
      isLoading: false,
    } as ReturnType<typeof useMessages>)
    vi.mocked(useAgentDefaults).mockReturnValue({
      data: defaults('architect'),
    } as ReturnType<typeof useAgentDefaults>)
    vi.mocked(useWorkingModes).mockReturnValue({
      data: [mode('code'), mode('architect')],
      isSuccess: true,
    } as ReturnType<typeof useWorkingModes>)

    const { result } = renderHook(() =>
      useSessionAgent('http://localhost:5551', 'session-1', '/assistant')
    )

    await waitFor(() => {
      expect(result.current.agent).toBe('architect')
    })
  })
})
