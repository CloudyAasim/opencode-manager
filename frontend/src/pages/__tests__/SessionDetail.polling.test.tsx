import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, type Query } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SessionDetail } from '../SessionDetail'

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  useMessages: vi.fn(),
  useSSE: vi.fn(),
  useRepoActivity: vi.fn(),
  usePermissions: vi.fn(),
  useQuestions: vi.fn(),
  useSSEHealth: vi.fn(),
  useConfig: vi.fn(),
  useOpenCodeClient: vi.fn(),
  useSettings: vi.fn(),
  useSettingsDialog: vi.fn(),
  useMobile: vi.fn(),
  useVisualViewport: vi.fn(),
  useKeyboardShortcuts: vi.fn(),
  useAutoScroll: vi.fn(),
  useLayer: vi.fn(),
  useSessionStatusForSession: vi.fn(),
  syncPermissionsForSession: vi.fn(),
  syncQuestionsForSession: vi.fn(),
  getRepo: vi.fn(),
}))

vi.mock('@/hooks/useOpenCode', () => ({
  useSession: mocks.useSession,
  useAbortSession: vi.fn(() => ({ mutate: vi.fn() })),
  useUpdateSession: vi.fn(() => ({ mutate: vi.fn() })),
  useCreateSession: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useMessages: mocks.useMessages,
  useConfig: mocks.useConfig,
}))

vi.mock('@/hooks/useModelSelection', () => ({
  useModelSelection: vi.fn(() => ({ model: null, modelString: null })),
}))

vi.mock('@/hooks/useOpenCodeClient', () => ({
  useOpenCodeClient: mocks.useOpenCodeClient,
}))

vi.mock('@/hooks/useTTS', () => ({
  useTTS: vi.fn(() => ({ isEnabled: false })),
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(() => ({
    preferences: { expandToolCalls: false },
    updateSettings: vi.fn(),
  })),
}))

vi.mock('@/hooks/useSettingsDialog', () => ({
  useSettingsDialog: vi.fn(() => ({ open: vi.fn() })),
}))

vi.mock('@/hooks/useMobile', () => ({
  useMobile: vi.fn(() => false),
  useSwipeBack: vi.fn(() => ({ ref: vi.fn() })),
}))

vi.mock('@/hooks/useVisualViewport', () => ({
  useVisualViewport: vi.fn(() => ({ keyboardHeight: 0 })),
}))

vi.mock('@/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn(() => ({ leaderActive: false })),
}))

vi.mock('@/hooks/useAutoScroll', () => ({
  useAutoScroll: vi.fn(() => ({ scrollToBottom: vi.fn() })),
}))

vi.mock('@/framework/layer/useLayer', () => ({
  useLayer: vi.fn(() => [false, vi.fn()]),
}))


vi.mock('@/hooks/useAutoPlayLastResponse', () => ({
  getAssistantText: vi.fn(() => ''),
  getLatestPlayableAssistantMessage: vi.fn(() => null),
  useAutoPlayLastResponse: vi.fn(() => {}),
}))

vi.mock('@/stores/uiStateStore', () => ({
  useUIState: vi.fn(() => vi.fn()),
}))

vi.mock('@/stores/sessionStatusStore', () => ({
  useSessionStatus: vi.fn(() => ({ setStatus: vi.fn() })),
  useSessionStatusForSession: mocks.useSessionStatusForSession,
}))

vi.mock('@/hooks/useSSE', () => ({
  useSSE: mocks.useSSE,
}))

vi.mock('@/hooks/useRepoActivity', () => ({
  useRepoActivity: mocks.useRepoActivity,
}))

vi.mock('@/contexts/EventContext', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    usePermissions: mocks.usePermissions,
    useQuestions: mocks.useQuestions,
    useSSEHealth: mocks.useSSEHealth,
  }
})

vi.mock('@/api/repos', () => ({
  getRepo: mocks.getRepo,
  initializeAssistantMode: vi.fn(() => Promise.resolve({ directory: '/test/repo' })),
}))

vi.mock('@/features/session/SessionList', () => ({ SessionList: vi.fn(() => null) }))
vi.mock('@/features/file-browser/FileBrowserSheet', () => ({ FileBrowserSheet: vi.fn(() => null) }))
vi.mock('@/features/repos/RepoMcpDialog', () => ({ RepoMcpDialog: vi.fn(() => null) }))
vi.mock('@/features/repos/ResetPermissionsDialog', () => ({ ResetPermissionsDialog: vi.fn(() => null) }))
vi.mock('@/features/repos/RepoLspDialog', () => ({ RepoLspDialog: vi.fn(() => null) }))
vi.mock('@/features/repos/RepoSkillsDialog', () => ({ RepoSkillsDialog: vi.fn(() => null) }))
vi.mock('@/features/source-control', () => ({ SourceControlPanel: vi.fn(() => null) }))
vi.mock('@/features/session/QuestionPrompt', () => ({ QuestionPrompt: vi.fn(() => null) }))
vi.mock('@/features/session/MinimizedQuestionIndicator', () => ({ MinimizedQuestionIndicator: vi.fn(() => null) }))
vi.mock('@/features/notifications/PendingActionsGroup', () => ({ PendingActionsGroup: vi.fn(() => null) }))

const findPendingActionsQuery = (queryClient: QueryClient): Query | undefined =>
  queryClient
    .getQueryCache()
    .getAll()
    .find((query) => query.queryKey[1] === 'pending-actions')

const HEALTHY_REPO = {
  id: 1,
  repoUrl: 'https://github.com/test/repo',
  localPath: '/test/repo',
  sourcePath: null,
  fullPath: '/test/repo',
  branch: 'main',
  currentBranch: 'main',
  fullSlug: 'test/repo',
  repoType: 'github' as const,
  directoryExists: true,
}

/**
 * Every hook the page calls, with a working default, in one place.
 *
 * It has to be shared rather than written out per describe: `vi.clearAllMocks()`
 * drops call history, so a describe that forgets to declare one of these hooks
 * then reads whatever the *previous* describe happened to leave behind - which
 * means the block only passes when it runs second. That is an order dependency,
 * and with --sequence.shuffle it is a coin flip rather than a bug report.
 */
const setUpDefaultMocks = () => {
  mocks.useSession.mockReturnValue({ data: undefined, isLoading: false })
  mocks.useMessages.mockReturnValue({ data: [], isLoading: false })
  mocks.useRepoActivity.mockReturnValue(undefined)
  mocks.usePermissions.mockReturnValue({
    pendingCount: 0,
    hasPermissionsForSession: vi.fn(() => false),
    syncForSession: mocks.syncPermissionsForSession,
  })
  mocks.useQuestions.mockReturnValue({
    current: null,
    getForSession: vi.fn(() => null),
    pendingCount: 0,
    hasQuestionsForSession: vi.fn(() => false),
    reply: vi.fn(),
    reject: vi.fn(),
    syncForSession: mocks.syncQuestionsForSession,
  })
  mocks.useSSEHealth.mockReturnValue({ isHealthy: true, isStalled: false })
  mocks.useConfig.mockReturnValue({ data: undefined, isLoading: false })
  mocks.useOpenCodeClient.mockReturnValue({})
  mocks.useSettings.mockReturnValue({
    preferences: { expandToolCalls: false },
    updateSettings: vi.fn(),
  })
  mocks.useSettingsDialog.mockReturnValue({ open: vi.fn() })
  mocks.useMobile.mockReturnValue(false)
  mocks.useVisualViewport.mockReturnValue({ keyboardHeight: 0 })
  mocks.useKeyboardShortcuts.mockReturnValue({ leaderActive: false })
  mocks.useAutoScroll.mockReturnValue({ scrollToBottom: vi.fn() })
  mocks.useLayer.mockReturnValue([false, vi.fn()])
  mocks.useSessionStatusForSession.mockReturnValue({ type: 'idle' })
  mocks.getRepo.mockResolvedValue(HEALTHY_REPO)
}

const createQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } })

const renderSessionDetail = (queryClient: QueryClient) =>
  render(
    <MemoryRouter initialEntries={['/repos/1/sessions/session-1']}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route path="/repos/:id/sessions/:sessionId" element={<SessionDetail />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  )

describe('SessionDetail pending-actions polling gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setUpDefaultMocks()
  })

  it('polls fast when disconnected and the session is active', async () => {
    mocks.useSSE.mockReturnValue({ isConnected: false, isReconnecting: false })
    mocks.useSessionStatusForSession.mockReturnValue({ type: 'busy' })

    const queryClient = createQueryClient()
    renderSessionDetail(queryClient)

    await waitFor(() => {
      expect(findPendingActionsQuery(queryClient)).toBeDefined()
    })

    const query = findPendingActionsQuery(queryClient)
    expect((query?.options as { refetchInterval?: unknown }).refetchInterval).toBe(6000)
  })

  it('keeps a slow safety net while the stream is connected and healthy', async () => {
    // This used to assert `false`. Gating the reconcile on isConnected meant a
    // stream that was open but not delivering switched the reconcile OFF, so a
    // permission or question that arrived as a lost event simply never appeared
    // - and the status bar still said connected. The slow interval is the price
    // of not trusting that state again.
    mocks.useSSE.mockReturnValue({ isConnected: true, isReconnecting: false })
    mocks.useSSEHealth.mockReturnValue({ isHealthy: true, isStalled: false })
    mocks.useSessionStatusForSession.mockReturnValue({ type: 'busy' })

    const queryClient = createQueryClient()
    renderSessionDetail(queryClient)

    await waitFor(() => {
      expect(findPendingActionsQuery(queryClient)).toBeDefined()
    })

    const query = findPendingActionsQuery(queryClient)
    expect((query?.options as { refetchInterval?: unknown }).refetchInterval).toBe(30000)
  })

  it('polls fast when the stream is connected but has stalled', async () => {
    // The case that could not be expressed before: the socket is up, so
    // isConnected is true, yet nothing is arriving.
    mocks.useSSE.mockReturnValue({ isConnected: true, isReconnecting: false })
    mocks.useSSEHealth.mockReturnValue({ isHealthy: false, isStalled: true })
    mocks.useSessionStatusForSession.mockReturnValue({ type: 'busy' })

    const queryClient = createQueryClient()
    renderSessionDetail(queryClient)

    await waitFor(() => {
      expect(findPendingActionsQuery(queryClient)).toBeDefined()
    })

    const query = findPendingActionsQuery(queryClient)
    expect((query?.options as { refetchInterval?: unknown }).refetchInterval).toBe(6000)
  })

  it('polls fast while the stream reports unhealthy without being flagged stalled', async () => {
    mocks.useSSE.mockReturnValue({ isConnected: true, isReconnecting: false })
    mocks.useSSEHealth.mockReturnValue({ isHealthy: false, isStalled: false })
    mocks.useSessionStatusForSession.mockReturnValue({ type: 'busy' })

    const queryClient = createQueryClient()
    renderSessionDetail(queryClient)

    await waitFor(() => {
      expect(findPendingActionsQuery(queryClient)).toBeDefined()
    })

    const query = findPendingActionsQuery(queryClient)
    expect((query?.options as { refetchInterval?: unknown }).refetchInterval).toBe(6000)
  })

  it('does not poll when disconnected but the session is idle with no incomplete messages', async () => {
    mocks.useSSE.mockReturnValue({ isConnected: false, isReconnecting: false })
    mocks.useSessionStatusForSession.mockReturnValue({ type: 'idle' })

    const queryClient = createQueryClient()
    renderSessionDetail(queryClient)

    await waitFor(() => {
      expect(findPendingActionsQuery(queryClient)).toBeDefined()
    })

    const query = findPendingActionsQuery(queryClient)
    expect((query?.options as { refetchInterval?: unknown }).refetchInterval).toBe(false)
  })

  it('requests message fallback polling while the SSE stream is disconnected', async () => {
    mocks.useSSE.mockReturnValue({ isConnected: false, isReconnecting: true })

    const queryClient = createQueryClient()
    renderSessionDetail(queryClient)

    const calls = mocks.useMessages.mock.calls
    expect(calls[calls.length - 1][3]).toEqual({ fallbackPoll: true })
  })

  it('does not request message fallback polling while the stream is delivering', async () => {
    // This used to read "while the SSE stream is connected" and assert false.
    // That was the bug: being attached is not the same as carrying events, so
    // a stream that was open but delivering nothing turned the message list's
    // only fallback off and froze the conversation on a stale snapshot. The
    // contract is delivery, not attachment.
    mocks.useSSE.mockReturnValue({ isConnected: true, isReconnecting: false })
    mocks.useSSEHealth.mockReturnValue({ isHealthy: true, isStalled: false })

    const queryClient = createQueryClient()
    renderSessionDetail(queryClient)

    const calls = mocks.useMessages.mock.calls
    expect(calls[calls.length - 1][3]).toEqual({ fallbackPoll: false })
  })

  it('requests message fallback polling while connected but stalled', async () => {
    // The case the old gate could not express at all.
    mocks.useSSE.mockReturnValue({ isConnected: true, isReconnecting: false })
    mocks.useSSEHealth.mockReturnValue({ isHealthy: false, isStalled: true })

    const queryClient = createQueryClient()
    renderSessionDetail(queryClient)

    const calls = mocks.useMessages.mock.calls
    expect(calls[calls.length - 1][3]).toEqual({ fallbackPoll: true })
  })

  it('requests message fallback polling while connected but unhealthy', async () => {
    mocks.useSSE.mockReturnValue({ isConnected: true, isReconnecting: false })
    mocks.useSSEHealth.mockReturnValue({ isHealthy: false, isStalled: false })

    const queryClient = createQueryClient()
    renderSessionDetail(queryClient)

    const calls = mocks.useMessages.mock.calls
    expect(calls[calls.length - 1][3]).toEqual({ fallbackPoll: true })
  })

  it('requests message fallback polling while the stream is reconnecting', async () => {
    mocks.useSSE.mockReturnValue({ isConnected: true, isReconnecting: true })
    mocks.useSSEHealth.mockReturnValue({ isHealthy: true, isStalled: false })

    const queryClient = createQueryClient()
    renderSessionDetail(queryClient)

    const calls = mocks.useMessages.mock.calls
    expect(calls[calls.length - 1][3]).toEqual({ fallbackPoll: true })
  })

  it('requests message fallback polling when health has not reported yet', async () => {
    // No health data cannot confirm delivery, so it belongs on the same side
    // as "not delivering". Reading through it would throw, and skipping it
    // would freeze the list on the one render that precedes the first
    // heartbeat.
    mocks.useSSE.mockReturnValue({ isConnected: true, isReconnecting: false })
    mocks.useSSEHealth.mockReturnValue(undefined as never)

    const queryClient = createQueryClient()
    renderSessionDetail(queryClient)

    const calls = mocks.useMessages.mock.calls
    expect(calls[calls.length - 1][3]).toEqual({ fallbackPoll: true })
  })
})

describe('SessionDetail when the repository directory is gone', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setUpDefaultMocks()
    mocks.useSSE.mockReturnValue({ isConnected: true, isReconnecting: false })
    mocks.getRepo.mockResolvedValue({
      id: 1,
      localPath: 'demo',
      fullPath: '/workspace/repos/demo',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: 0,
      directoryExists: false,
    })
  })

  it('names the missing path instead of rendering a session that looks alive', async () => {
    // The row still said "ready", so the header, the prompt and the message
    // list all rendered: the question was visible from the last successful
    // load, the answer never arrived, and nothing reported a problem.
    renderSessionDetail(createQueryClient())

    await waitFor(() => {
      expect(screen.getByText(/\/workspace\/repos\/demo/)).toBeInTheDocument()
    })
  })

  it('stops rendering the session shell instead of leaving a plausible empty one', async () => {
    renderSessionDetail(createQueryClient())

    await waitFor(() => {
      expect(screen.getByText(/\/workspace\/repos\/demo/)).toBeInTheDocument()
    })
    // The hooks still run - React has no early return - but the session header,
    // the prompt and the cached message list must not. A stale cached list is
    // exactly what used to masquerade as a working, merely quiet, session.
    expect(screen.queryByTestId('session-header-region')).not.toBeInTheDocument()
  })

  it('still renders the session when the backend does not report the directory', async () => {
    // An older backend omits the field. Absent is not the same as false, and
    // refusing to render on absence would break every un-upgraded deployment.
    mocks.getRepo.mockResolvedValue({
      id: 1,
      localPath: 'demo',
      fullPath: '/workspace/repos/demo',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: 0,
    })

    renderSessionDetail(createQueryClient())

    await waitFor(() => {
      expect(mocks.useMessages).toHaveBeenCalled()
    })
    expect(screen.queryByText(/\/workspace\/repos\/demo/)).not.toBeInTheDocument()
  })
})
