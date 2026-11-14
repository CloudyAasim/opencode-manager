import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { useCommands } from './useCommands'
import { createBffClient } from '../api/bff'
import { createQueryClient } from '../lib/queryClient'

vi.mock('../api/bff', () => ({
  createBffClient: vi.fn(),
}))

const createWrapper = () => {
  // The app's own client, with the app's own stale time.
  //
  // This matters more than it looks: a query that is answered locally looks
  // fresh for that stale time, and a fresh query is not asked again. The
  // command list was answered locally with the built-in commands, and with a
  // stale time of a minute the layer was never asked - so a test with no
  // stale time at all would pass while the app quietly did the wrong thing.
  const queryClient = createQueryClient()
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

  it('asks the layer even when the layer is this origin', async () => {
    // An empty address is not the absence of a layer: it is the layer whose
    // address is the origin this page was served from, which is where most
    // deployments live and where every installed client lives. A client that
    // reads it as "no server" stops asking, and the command list then
    // quietly never arrives - with nothing on screen saying so.
    const listCommands = vi.fn().mockResolvedValue({ commands: [] })
    vi.mocked(createBffClient).mockReturnValue({
      listCommands,
    } as unknown as ReturnType<typeof createBffClient>)

    renderHook(() => useCommands(''), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(listCommands).toHaveBeenCalled()
    })
    expect(vi.mocked(createBffClient)).toHaveBeenCalledWith('')
  })

  it('shows the built-in commands while the layer is still answering', () => {
    // The built-ins are what to show until the layer answers - they are not
    // the answer. So the palette is never empty, and the layer's list
    // replaces them when it arrives.
    const listCommands = vi.fn().mockImplementation(() => new Promise(() => {}))
    vi.mocked(createBffClient).mockReturnValue({
      listCommands,
    } as unknown as ReturnType<typeof createBffClient>)

    const { result } = renderHook(() => useCommands(''), { wrapper: createWrapper() })

    expect(result.current.filterCommands('').map(command => command.name)).toContain('clear')
    expect(listCommands).toHaveBeenCalled()
  })
})
