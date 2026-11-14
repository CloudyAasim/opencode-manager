import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useCommands } from './useCommands'
import { createBffClient } from '../api/bff'

vi.mock('../api/bff', () => ({
  createBffClient: vi.fn(),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    }
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns commands in alphabetical order when there is no query', () => {
    const { result } = renderHook(() => useCommands(null), { wrapper: createWrapper() })

    expect(result.current.filterCommands('').map(command => command.name).slice(0, 5)).toEqual([
      'clear',
      'compact',
      'continue',
      'details',
      'editor',
    ])
  })

  it('prioritizes exact and prefix matches before other matches', () => {
    const { result } = renderHook(() => useCommands(null), { wrapper: createWrapper() })

    expect(result.current.filterCommands('co').map(command => command.name)).toEqual([
      'compact',
      'continue',
    ])
    expect(result.current.filterCommands('do').map(command => command.name)).toEqual([
      'redo',
      'undo',
    ])
  })

  it('sorts loaded custom commands with built-in commands', async () => {
    vi.mocked(createBffClient).mockReturnValue({
      listCommands: vi.fn().mockResolvedValue({
        commands: [
          {
            name: 'zebra',
            description: '',
            workingMode: null,
            model: null,
            template: '',
            subtask: false,
            hints: [],
          },
          {
            name: 'alpha',
            description: '',
            workingMode: null,
            model: null,
            template: '',
            subtask: false,
            hints: [],
          },
        ],
      }),
    } as unknown as ReturnType<typeof createBffClient>)

    const { result } = renderHook(() => useCommands('http://localhost:5551'), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.filterCommands('').map(command => command.name).slice(0, 3)).toEqual([
        'alpha',
        'clear',
        'compact',
      ])
    })
  })
})
