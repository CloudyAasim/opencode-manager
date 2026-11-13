import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingPermission, PendingQuestion } from '@opencode-manager/shared/api/v1'
import type { QuestionRequest } from '@/api/types'
import { EventProvider, useEventContext, usePermissions, useQuestions, useSSEHealth } from './EventContext'

const mocks = vi.hoisted(() => ({
  listRepos: vi.fn(),
  listPending: vi.fn(),
  replyToQuestion: vi.fn(),
  rejectQuestion: vi.fn(),
  respondToPermission: vi.fn(),
  subscribeGlobalMonitor: vi.fn(),
  getHealth: vi.fn(),
}))

vi.mock('@/api/repos', () => ({
  listRepos: mocks.listRepos,
}))

// The client asks the layer for what the agent is waiting for, so that is
// what this test controls: one answer for every directory, in the versioned
// dialect the app keeps. Answering a permission and answering a question
// go to the same layer, for the same reason.
vi.mock('@/api/bff', () => ({
  createBffClient: vi.fn(() => ({
    listPending: mocks.listPending,
    replyToQuestion: mocks.replyToQuestion,
    rejectQuestion: mocks.rejectQuestion,
    respondToPermission: mocks.respondToPermission,
  })),
}))

vi.mock('@/lib/opencode-event-stream', () => ({
  openCodeEventStream: {
    subscribeGlobalMonitor: mocks.subscribeGlobalMonitor,
    getHealth: mocks.getHealth,
  },
}))

vi.mock('@/lib/toast', () => ({
  showToast: {
    error: vi.fn(),
    info: vi.fn(),
  },
}))

/**
 * What the layer answers: the versioned dialect, the one the app keeps.
 */
const pendingQuestion: PendingQuestion = {
  id: 'question-1',
  sessionId: 'session-1',
  directory: '/repo',
  questions: [
    {
      question: 'Continue?',
      header: 'Confirm',
      options: [
        {
          label: 'Yes',
          description: 'Continue',
        },
      ],
      multiple: false,
    },
  ],
  tool: null,
}

const secondPendingQuestion: PendingQuestion = {
  id: 'question-2',
  sessionId: 'session-2',
  directory: '/repo',
  questions: [
    {
      question: 'Deploy?',
      header: 'Deploy',
      options: [
        {
          label: 'Yes',
          description: 'Deploy changes',
        },
      ],
      multiple: false,
    },
  ],
  tool: null,
}

const pendingPermission: PendingPermission = {
  id: 'permission-1',
  sessionId: 'session-1',
  directory: '/repo',
  permission: 'bash',
  patterns: ['echo hello'],
  metadata: {},
  always: [],
  tool: {
    messageId: 'message-1',
    callId: 'call-1',
  },
}

const secondPendingPermission: PendingPermission = {
  id: 'permission-2',
  sessionId: 'session-1',
  directory: '/repo',
  permission: 'write',
  patterns: ['/tmp/test.txt'],
  metadata: {},
  always: [],
  tool: {
    messageId: 'message-2',
    callId: 'call-2',
  },
}

/**
 * What the stream says: the agent's own dialect, which is the one thing the
 * app is allowed to hold in the agent's words.
 */
const agentQuestionEvent: QuestionRequest = {
  id: 'question-1',
  sessionID: 'session-1',
  questions: [
    {
      question: 'Continue?',
      header: 'Confirm',
      options: [
        {
          label: 'Yes',
          description: 'Continue',
        },
      ],
      multiple: false,
    },
  ],
}

function Harness() {
  const { current, pendingCount, syncForSession, navigateToCurrent, reject, reply, getForSession } = useQuestions()
  const permissions = usePermissions()
  const permissionForCall = permissions.getForCallID('call-1', 'session-1')
  const location = useLocation()

  return (
    <div>
      <div data-testid="count">{pendingCount}</div>
      <div data-testid="current">{current?.id ?? 'none'}</div>
      <div data-testid="for-session-1">{getForSession('session-1')?.id ?? 'none'}</div>
      <div data-testid="for-session-2">{getForSession('session-2')?.id ?? 'none'}</div>
      <div data-testid="for-session-unknown">{getForSession('session-unknown')?.id ?? 'none'}</div>
      <div data-testid="permission-count">{permissions.pendingCount}</div>
      <div data-testid="permission-current">{permissions.current?.id ?? 'none'}</div>
      <div data-testid="permission-call">{permissionForCall?.id ?? 'none'}</div>
      <div data-testid="path">{location.pathname}</div>
      <button onClick={() => syncForSession('/repo', 'session-1')}>Sync</button>
      <button onClick={() => permissions.syncForSession('/repo', 'session-1')}>Sync Permissions</button>
      <button onClick={navigateToCurrent}>Navigate</button>
      <button onClick={() => { if (current) void reject(current.id).catch(() => {}) }}>Dismiss</button>
      <button onClick={() => { if (current) void reply(current.id, [['Yes']]).catch(() => {}) }}>Reply</button>
      <button onClick={() => { const p = permissions.current; if (p) void permissions.respond(p.id, p.sessionId, 'allow').catch(() => {}) }}>Allow Permission</button>
      <button onClick={() => { const p = permissions.current; if (p) void permissions.respond(p.id, p.sessionId, 'reject').catch(() => {}) }}>Reject Permission</button>
    </div>
  )
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <EventProvider>{children}</EventProvider>
      </QueryClientProvider>
    </MemoryRouter>
  )
}

describe('EventProvider questions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listRepos.mockResolvedValue([])
    mocks.listPending.mockResolvedValue({ permissions: [], questions: [] })
    mocks.replyToQuestion.mockResolvedValue(undefined)
    mocks.rejectQuestion.mockResolvedValue(undefined)
    // vi.clearAllMocks() keeps implementations, so every mock this block reads
    // has to be re-declared here; a mockRejectedValue from an earlier test
    // otherwise still rejects and restores the permission it just removed.
    mocks.respondToPermission.mockResolvedValue(undefined)
    mocks.getHealth.mockReturnValue({ isConnected: false, isHealthy: false, lastEventAt: null, isStalled: false })
    mocks.subscribeGlobalMonitor.mockReturnValue({
      dispose: vi.fn(),
      updateDirectories: vi.fn(),
      reconnect: vi.fn(),
      reportVisibility: vi.fn(),
    })
  })

  it('syncs missed pending questions for a session', async () => {
    mocks.listPending.mockResolvedValue({ permissions: [], questions: [pendingQuestion] })

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
      expect(screen.getByTestId('current')).toHaveTextContent('question-1')
    })
  })

  it('syncs missed pending permissions for a session', async () => {
    mocks.listPending.mockResolvedValue({ permissions: [pendingPermission], questions: [] })

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync Permissions' }))

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('1')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-1')
      expect(screen.getByTestId('permission-call')).toHaveTextContent('permission-1')
    })
  })

  it('clears stale pending permissions for a session', async () => {
    mocks.listPending
      .mockResolvedValueOnce({ permissions: [pendingPermission], questions: [] })
      .mockResolvedValueOnce({ permissions: [], questions: [] })

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync Permissions' }))

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Sync Permissions' }))

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('0')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('none')
    })
  })

  it('advances to the remaining permission after rejecting the current one of two in the same session', async () => {
    mocks.listPending.mockResolvedValue({ permissions: [pendingPermission, secondPendingPermission], questions: [] })

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync Permissions' }))

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('2')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Reject Permission' }))

    await waitFor(() => {
      expect(mocks.respondToPermission).toHaveBeenCalledTimes(1)
      // The conversation is named, and the working directory the app happens
      // to know is offered as a fallback - the layer works out where the
      // conversation lives on its own.
      expect(mocks.respondToPermission).toHaveBeenCalledWith(
        'session-1',
        'permission-1',
        'reject',
        ['/repo'],
      )
      expect(screen.getByTestId('permission-count')).toHaveTextContent('1')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-2')
    })
  })

  it('clears stale pending questions for a session', async () => {
    mocks.listPending
      .mockResolvedValueOnce({ permissions: [], questions: [pendingQuestion] })
      .mockResolvedValueOnce({ permissions: [], questions: [] })

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('reconciles pending questions for the whole directory', async () => {
    mocks.listPending
      .mockResolvedValueOnce({ permissions: [], questions: [pendingQuestion, secondPendingQuestion] })
      .mockResolvedValueOnce({ permissions: [], questions: [pendingQuestion] })

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('2')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
      expect(screen.getByTestId('current')).toHaveTextContent('question-1')
    })
  })

  it('resolves pending questions per session independently of the global current', async () => {
    mocks.listPending.mockResolvedValue({ permissions: [], questions: [pendingQuestion, secondPendingQuestion] })

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('2')
    })

    expect(screen.getByTestId('current')).toHaveTextContent('question-1')
    expect(screen.getByTestId('for-session-1')).toHaveTextContent('question-1')
    expect(screen.getByTestId('for-session-2')).toHaveTextContent('question-2')
    expect(screen.getByTestId('for-session-unknown')).toHaveTextContent('none')
  })

  it('reconciles stale pending questions after reconnect', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listPending
      .mockResolvedValueOnce({ permissions: [], questions: [pendingQuestion] })
      .mockResolvedValueOnce({ permissions: [], questions: [] })

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    })

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void
    handleStatusChange(true)

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('navigates to a synced pending question without session query cache', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listPending.mockResolvedValue({ permissions: [], questions: [pendingQuestion] })

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('current')).toHaveTextContent('question-1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Navigate' }))

    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('/repos/123/sessions/session-1')
    })
  })

  it('clears a pending question after dismiss succeeds', async () => {
    mocks.listPending.mockResolvedValue({ permissions: [], questions: [pendingQuestion] })

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('clears a pending question after reply succeeds', async () => {
    mocks.listPending.mockResolvedValue({ permissions: [], questions: [pendingQuestion] })

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Reply' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('dismisses the question before the reply finishes', async () => {
    let release!: () => void
    const inFlight = new Promise<void>((resolve) => { release = resolve })
    mocks.listPending.mockResolvedValue({ permissions: [], questions: [pendingQuestion] })
    mocks.replyToQuestion.mockReturnValue(inFlight)

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByText('Sync'))
    expect(screen.getByTestId('current')).toHaveTextContent('question-1')

    await userEvent.click(screen.getByText('Reply'))

    // gone from the screen while the request is still in the air
    expect(screen.getByTestId('current')).toHaveTextContent('none')
    expect(mocks.replyToQuestion).toHaveBeenCalled()

    release()
    await waitFor(() => expect(mocks.replyToQuestion).toHaveBeenCalled())
  })

  it('brings the question back when the reply fails', async () => {
    mocks.listPending.mockResolvedValue({ permissions: [], questions: [pendingQuestion] })
    mocks.replyToQuestion.mockRejectedValue(new Error('offline'))

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByText('Sync'))
    await userEvent.click(screen.getByText('Reply'))

    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('question-1'))
  })

  it('takes the permission off screen before the answer is sent', async () => {
    let release!: () => void
    const inFlight = new Promise<void>((resolve) => { release = resolve })
    mocks.listPending.mockResolvedValue({ permissions: [pendingPermission], questions: [] })
    mocks.respondToPermission.mockReturnValue(inFlight)

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByText('Sync Permissions'))
    expect(screen.getByTestId('permission-count')).toHaveTextContent('1')

    await userEvent.click(screen.getByText('Allow Permission'))

    expect(screen.getByTestId('permission-count')).toHaveTextContent('0')
    expect(mocks.respondToPermission).toHaveBeenCalled()

    release()
  })

  it('brings the permission back when answering fails', async () => {
    mocks.listPending.mockResolvedValue({ permissions: [pendingPermission], questions: [] })
    mocks.respondToPermission.mockRejectedValue(new Error('offline'))

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByText('Sync Permissions'))
    await userEvent.click(screen.getByText('Allow Permission'))

    await waitFor(() => expect(screen.getByTestId('permission-count')).toHaveTextContent('1'))
  })

  it('adds a pending question received via the global monitor onEvent', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled()
    })

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({
        type: 'question.asked',
        properties: agentQuestionEvent,
        directory: '/repo',
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
      expect(screen.getByTestId('current')).toHaveTextContent('question-1')
    })
  })



  it('handles session.updated event without throwing when cache has infinite-query data', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    // Seed infinite-query shaped data into session-list cache
    queryClient.setQueryData(
      ['bff', 'sessions', 'http://localhost:5551', '/repo', { search: undefined, limit: 25 }],
      {
        pages: [{
          items: [
            { id: 'existing-session', projectID: 'proj-1', title: 'Existing', directory: '/repo', time: { created: 1000, updated: 1000 } },
          ],
          cursors: {},
        }],
        pageParams: [undefined],
      },
    )

    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <EventProvider>{children}</EventProvider>
        </QueryClientProvider>
      </MemoryRouter>
    )

    render(<Harness />, { wrapper })

    await waitFor(() => {
      expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled()
    })

    // Trigger session.updated event - should not throw with infinite-query cache data
    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    expect(() => {
      act(() => {
        onEvent({
          type: 'session.updated',
          properties: {
            info: { id: 'new-session', projectID: 'proj-1', title: 'New', directory: '/repo', time: { created: 2000, updated: 2000 } },
          },
        })
      })
    }).not.toThrow()
  })

  it('the session directory resolves from the infinite-query session list cache', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    // Seed infinite-query data with a session that has directory field
    queryClient.setQueryData(
      ['bff', 'sessions', 'http://localhost:5551', '/repo', { search: undefined, limit: 25 }],
      {
        pages: [{
          items: [
            { id: 'ses-infinite', projectID: 'proj-1', title: 'From Infinite Query', directory: '/repo', time: { created: 1000, updated: 1000 } },
          ],
          cursors: {},
        }],
        pageParams: [undefined],
      },
    )

    // Ensure no single-session cache exists for this session (forces fallback to session-list lookup)
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <EventProvider>{children}</EventProvider>
        </QueryClientProvider>
      </MemoryRouter>
    )

    function ClientHarness() {
      const { getSessionDirectory } = useEventContext()
      const directory = getSessionDirectory('ses-infinite')
      return <div data-testid="client-result">{directory ?? 'not-found'}</div>
    }

    render(<ClientHarness />, { wrapper })

    await waitFor(() => {
      expect(screen.getByTestId('client-result')).toHaveTextContent('/repo')
    })
  })

  it('exposes sseHealth through context', async () => {
    mocks.getHealth.mockReturnValue({ isConnected: true, isHealthy: true, lastEventAt: Date.now(), isStalled: false })
    mocks.subscribeGlobalMonitor.mockImplementation(({ onHealthChange }) => {
      onHealthChange({ isConnected: false, isHealthy: false, lastEventAt: null, isStalled: false })
      return {
        dispose: vi.fn(),
        updateDirectories: vi.fn(),
        reconnect: vi.fn(),
        reportVisibility: vi.fn(),
      }
    })

    const TestComponent = () => {
      const { isConnected, isHealthy, isStalled } = useSSEHealth()
      return (
        <div>
          <div data-testid="connected">{String(isConnected)}</div>
          <div data-testid="healthy">{String(isHealthy)}</div>
          <div data-testid="stalled">{String(isStalled)}</div>
        </div>
      )
    }

    render(<TestComponent />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByTestId('connected')).toHaveTextContent('false')
      expect(screen.getByTestId('healthy')).toHaveTextContent('false')
    })
  })

  it('does not re-render consumers for health notifications that only change lastEventAt', async () => {
    let onHealthChange: (state: { isConnected: boolean; isHealthy: boolean; lastEventAt: number | null; isStalled: boolean }) => void = () => {}
    mocks.subscribeGlobalMonitor.mockImplementation(({ onHealthChange: handler }) => {
      onHealthChange = handler
      return {
        dispose: vi.fn(),
        updateDirectories: vi.fn(),
        reconnect: vi.fn(),
        reportVisibility: vi.fn(),
      }
    })

    let renderCount = 0

    const Probe = () => {
      renderCount += 1
      const { isConnected } = useSSEHealth()
      return <div data-testid="probe-connected">{String(isConnected)}</div>
    }

    render(<Probe />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByTestId('probe-connected')).toHaveTextContent('false')
    })
    const initialRenderCount = renderCount

    act(() => {
      onHealthChange({ isConnected: true, isHealthy: true, lastEventAt: 1, isStalled: false })
    })

    await waitFor(() => {
      expect(screen.getByTestId('probe-connected')).toHaveTextContent('true')
    })
    const afterBooleanChange = renderCount

    act(() => {
      onHealthChange({ isConnected: true, isHealthy: true, lastEventAt: 2, isStalled: false })
      onHealthChange({ isConnected: true, isHealthy: true, lastEventAt: 3, isStalled: false })
    })

    expect(afterBooleanChange).toBe(initialRenderCount + 1)
    expect(renderCount).toBe(afterBooleanChange)
  })
  it('fetches pending permissions and questions the moment health drops', async () => {
    // The reconcile only ran on (re)connect, so a stream that degraded in place
    // - still open, no longer delivering - had no repair path at all until the
    // next reload. This edge is the repair.
    // fetchInitialPendingData returns early without repos, so give it one.
    mocks.listRepos.mockResolvedValue([{ id: 1, name: 'one', fullPath: '/repo/one' } as never])

    let onHealthChange: (state: { isConnected: boolean; isHealthy: boolean; lastEventAt: number | null; isStalled: boolean }) => void = () => {}
    mocks.subscribeGlobalMonitor.mockImplementation(({ onHealthChange: handler }) => {
      onHealthChange = handler
      return {
        dispose: vi.fn(),
        updateDirectories: vi.fn(),
        reconnect: vi.fn(),
        reportVisibility: vi.fn(),
      }
    })

    render(<div data-testid="probe" />, { wrapper: createWrapper() })

    // Wait for the repos query to resolve and the initial fetch to happen.
    await waitFor(() => {
      expect(mocks.listPending.mock.calls.length).toBeGreaterThan(0)
    })
    const callsBeforeEdge = mocks.listPending.mock.calls.length

    act(() => {
      onHealthChange({ isConnected: true, isHealthy: true, lastEventAt: 1, isStalled: false })
    })

    act(() => {
      onHealthChange({ isConnected: true, isHealthy: false, lastEventAt: 1, isStalled: true })
    })

    await waitFor(() => {
      expect(mocks.listPending.mock.calls.length).toBeGreaterThan(callsBeforeEdge)
    })
  })

  it('refetches on the health edge only, not on every unhealthy heartbeat', async () => {
    // onHealthChange fires on every message and every heartbeat. Triggering on
    // the level instead of the edge would fetch pending data forever.
    mocks.listRepos.mockResolvedValue([{ id: 1, name: 'one', fullPath: '/repo/one' } as never])

    let onHealthChange: (state: { isConnected: boolean; isHealthy: boolean; lastEventAt: number | null; isStalled: boolean }) => void = () => {}
    mocks.subscribeGlobalMonitor.mockImplementation(({ onHealthChange: handler }) => {
      onHealthChange = handler
      return {
        dispose: vi.fn(),
        updateDirectories: vi.fn(),
        reconnect: vi.fn(),
        reportVisibility: vi.fn(),
      }
    })

    render(<div data-testid="probe" />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(mocks.listPending.mock.calls.length).toBeGreaterThan(0)
    })

    act(() => {
      onHealthChange({ isConnected: true, isHealthy: false, lastEventAt: 1, isStalled: true })
    })

    await waitFor(() => {
      expect(mocks.listPending.mock.calls.length).toBeGreaterThan(0)
    })
    const afterEdge = mocks.listPending.mock.calls.length

    act(() => {
      onHealthChange({ isConnected: true, isHealthy: false, lastEventAt: 2, isStalled: true })
      onHealthChange({ isConnected: true, isHealthy: false, lastEventAt: 3, isStalled: true })
      onHealthChange({ isConnected: true, isHealthy: false, lastEventAt: 4, isStalled: true })
    })

    expect(mocks.listPending.mock.calls.length).toBe(afterEdge)
  })
})
