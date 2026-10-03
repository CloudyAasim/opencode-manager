import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { useUIState } from '@/stores/uiStateStore'
import { LayerProvider } from '@/framework/layer/LayerProvider'
import type { FileInfo } from '@/types/files'
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
  commands: [
    { name: 'help', description: 'Show the help screen', template: '', agent: '', model: '', hints: [] },
    { name: 'init', description: 'Initialise the repository', template: '', agent: '', model: '', hints: [] },
    { name: 'sessions', description: 'Browse other sessions', template: '', agent: '', model: '', hints: [] },
  ],
}))

// The composer pulls in most of this module, not just what SessionDetail
// itself calls, so the whole surface is stubbed rather than the five hooks
// this page names.
vi.mock('@/hooks/useOpenCode', () => ({
  useSession: mocks.useSession,
  useAbortSession: vi.fn(() => ({ mutate: vi.fn() })),
  useUpdateSession: vi.fn(() => ({ mutate: vi.fn() })),
  useCreateSession: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useDeleteSession: vi.fn(() => ({ mutate: vi.fn() })),
  useMessages: mocks.useMessages,
  useConfig: mocks.useConfig,
  useAgents: vi.fn(() => ({ data: [], isSuccess: true, isLoading: false })),
  useSendPrompt: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useSendShell: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useSessionsAcrossDirectories: vi.fn(() => ({ data: [], isLoading: false })),
  useLoadSkill: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn() })),
  useOpenCodeClient: mocks.useOpenCodeClient,
}))

vi.mock('@/hooks/useCommands', () => ({
  useCommands: () => ({
    commands: mocks.commands,
    loading: false,
    error: null,
    filterCommands: (query: string) => {
      if (!query.trim()) return mocks.commands
      const term = query.toLowerCase()
      return mocks.commands.filter((c) => c.name.toLowerCase().includes(term))
    },
  }),
}))

vi.mock('@/hooks/useModelSelection', () => ({
  useModelSelection: vi.fn(() => ({ model: null, modelString: null })),
}))

vi.mock('@/hooks/useTTS', () => ({
  useTTS: vi.fn(() => ({ isEnabled: false })),
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: mocks.useSettings,
}))

vi.mock('@/hooks/useSettingsDialog', () => ({
  useSettingsDialog: mocks.useSettingsDialog,
}))

vi.mock('@/hooks/useMobile', () => ({
  useMobile: mocks.useMobile,
  useSwipeBack: vi.fn(() => ({ bind: () => () => {}, ref: vi.fn() })),
}))

vi.mock('@/hooks/useVisualViewport', () => ({
  useVisualViewport: mocks.useVisualViewport,
}))

vi.mock('@/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: mocks.useKeyboardShortcuts,
}))

vi.mock('@/hooks/useAutoScroll', () => ({
  useAutoScroll: mocks.useAutoScroll,
}))

vi.mock('@/hooks/useAutoPlayLastResponse', () => ({
  getAssistantText: vi.fn(() => ''),
  getLatestPlayableAssistantMessage: vi.fn(() => null),
  useAutoPlayLastResponse: vi.fn(() => {}),
}))

vi.mock('@/stores/sessionStatusStore', () => ({
  useSessionStatus: vi.fn(() => ({ setStatus: vi.fn() })),
  useSessionStatusForSession: vi.fn(() => ({ type: 'idle' })),
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
  getRepo: vi.fn(() => Promise.resolve({
    id: 1,
    repoUrl: 'https://github.com/test/repo',
    localPath: '/test/repo',
    sourcePath: null,
    fullPath: '/test/repo',
    branch: 'main',
    currentBranch: 'main',
    fullSlug: 'test/repo',
    repoType: 'github' as const,
  })),
  initializeAssistantMode: vi.fn(() => Promise.resolve({ directory: '/test/repo' })),
}))

vi.mock('@/features/session/SessionList', () => ({
  SessionList: vi.fn(() => null),
}))

// The composer itself is not what this file is about - it is a large subtree
// with its own providers. What matters here is the strip above it and what the
// store receives, so the composer stands in as a stub that renders nothing.
// (PromptInput's own consumption of these signals is covered by its tests.)
vi.mock('@/features/message/PromptInput', () => ({
  PromptInput: ({ ref: _ref, ...props }: Record<string, unknown>) => (
    <div data-testid="prompt-input" data-has-session={String(Boolean(props.sessionID))} />
  ),
}))

vi.mock('@/features/file-browser/FileBrowserSheet', () => ({
  FileBrowserSheet: ({
    isOpen,
    basePath,
    onFileSelect,
  }: {
    isOpen: boolean
    basePath: string
    onFileSelect: (file: FileInfo) => void
  }) =>
    isOpen ? (
      <div data-testid="mention-file-browser" data-base-path={basePath}>
        <button
          type="button"
          onClick={() => onFileSelect({ path: `${basePath}/src/App.tsx` } as FileInfo)}
        >
          App.tsx
        </button>
      </div>
    ) : null,
}))

vi.mock('@/features/repos/RepoMcpDialog', () => ({
  RepoMcpDialog: vi.fn(() => null),
}))

vi.mock('@/features/repos/ResetPermissionsDialog', () => ({
  ResetPermissionsDialog: vi.fn(() => null),
}))

vi.mock('@/features/repos/RepoLspDialog', () => ({
  RepoLspDialog: vi.fn(() => null),
}))

vi.mock('@/features/repos/RepoSkillsDialog', () => ({
  RepoSkillsDialog: vi.fn(() => null),
}))

vi.mock('@/features/source-control', () => ({
  SourceControlPanel: vi.fn(() => null),
}))

vi.mock('@/features/session/QuestionPrompt', () => ({
  QuestionPrompt: vi.fn(() => null),
}))

vi.mock('@/features/session/MinimizedQuestionIndicator', () => ({
  MinimizedQuestionIndicator: vi.fn(() => null),
}))

vi.mock('@/features/notifications/PendingActionsGroup', () => ({
  PendingActionsGroup: vi.fn(() => null),
}))

/**
 * The command and mention-file entries used to sit in the mobile "more"
 * drawer, above Settings, even though they feed the composer and nothing
 * else. They now live on the conversation screen. These tests pin the new
 * location; the drawer-side test file pins that they left the drawer.
 */
describe('会话界面上的命令与引用文件入口', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUIState.setState({
      pendingPromptCommand: null,
      pendingPromptFile: null,
      activePromptFileBasePath: null,
    })

    mocks.useSession.mockReturnValue({ data: undefined, isLoading: false })
    mocks.useMessages.mockReturnValue({ data: [], isLoading: false })
    mocks.useSSE.mockReturnValue({ isConnected: true, isReconnecting: false })
    mocks.useRepoActivity.mockReturnValue(undefined)
    mocks.usePermissions.mockReturnValue({
      pendingCount: 0,
      hasPermissionsForSession: vi.fn(() => false),
      hasForSession: vi.fn(() => false),
      setShowDialog: vi.fn(),
      syncForSession: vi.fn(),
    })
    mocks.useQuestions.mockReturnValue({
      current: null,
      getForSession: vi.fn(() => null),
      pendingCount: 0,
      hasQuestionsForSession: vi.fn(() => false),
      reply: vi.fn(),
      reject: vi.fn(),
      syncForSession: vi.fn(),
    })
    mocks.useSSEHealth.mockReturnValue({ isHealthy: true })
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
  })

  const createQueryClient = () =>
    new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const renderSessionDetail = async () => {
    const result = render(
      <MemoryRouter initialEntries={['/repos/1/sessions/session-1']}>
        <LayerProvider>
          <QueryClientProvider client={createQueryClient()}>
            <Routes>
              <Route path="/repos/:id/sessions/:sessionId" element={<SessionDetail />} />
            </Routes>
          </QueryClientProvider>
        </LayerProvider>
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('session-commands-trigger')).toBeInTheDocument()
    })
    return result
  }

  it('命令和引用文件就在会话界面上，不用先去菜单里找', async () => {
    await renderSessionDetail()

    expect(screen.getByTestId('session-commands-trigger')).toBeInTheDocument()
    expect(screen.getByTestId('session-mention-file-trigger')).toBeInTheDocument()
  })

  it('展开命令面板并选中一个命令', async () => {
    await renderSessionDetail()

    expect(screen.queryByTestId('session-command-panel')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('session-commands-trigger'))

    const panel = await screen.findByTestId('session-command-panel')
    expect(panel).toBeInTheDocument()

    fireEvent.click(screen.getByText('help'))

    expect(useUIState.getState().pendingPromptCommand?.command.name).toBe('help')
    expect(screen.queryByTestId('session-command-panel')).not.toBeInTheDocument()
  })

  it('命令面板可以搜索，搜不到时给出空态', async () => {
    await renderSessionDetail()
    fireEvent.click(screen.getByTestId('session-commands-trigger'))
    await screen.findByTestId('session-command-panel')

    const search = screen.getByRole('textbox')
    fireEvent.change(search, { target: { value: 'sess' } })

    expect(screen.getByText('sessions')).toBeInTheDocument()
    expect(screen.queryByText('help')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'nothing-matches-this' } })
    expect(screen.queryByText('sessions')).not.toBeInTheDocument()
    expect(screen.getByText('No matching command')).toBeInTheDocument()
  })

  it('引用文件直接打开选择器，选中后按工作目录换算路径', async () => {
    await renderSessionDetail()

    expect(screen.queryByTestId('mention-file-browser')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('session-mention-file-trigger'))

    const browser = await screen.findByTestId('mention-file-browser')
    // The page hands the picker the directory the conversation is in.
    expect(browser.getAttribute('data-base-path')).toBe('/test/repo')

    fireEvent.click(screen.getByText('App.tsx'))

    // ...and what lands in the prompt is relative to it, not absolute.
    expect(useUIState.getState().pendingPromptFile?.path).toBe('src/App.tsx')
    expect(screen.queryByTestId('mention-file-browser')).not.toBeInTheDocument()
  })
})
