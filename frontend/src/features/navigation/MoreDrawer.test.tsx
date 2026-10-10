import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MoreDrawer } from './MoreDrawer'
import { useAuth } from '@/hooks/useAuth'
import { useServerHealth } from '@/hooks/useServerHealth'
import { getRepo } from '@/api/repos'

vi.mock('@/hooks/useAuth')
vi.mock('@/hooks/useServerHealth')
vi.mock('@/api/repos', () => ({
  getRepo: vi.fn(),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: vi.fn(),
  }
})

const mockAuth = (logout = vi.fn()) => {
  vi.mocked(useAuth).mockReturnValue({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    config: null,
    signInWithEmail: vi.fn(),
    signInWithProvider: vi.fn(),
    signInWithPasskey: vi.fn(),
    signUpWithEmail: vi.fn(),
    addPasskey: vi.fn(),
    logout,
    refreshSession: vi.fn(),
  })
}

const mockServerHealth = (health?: Partial<ReturnType<typeof useServerHealth>['data']>) => {
  const baseHealth = {
    status: 'healthy' as const,
    timestamp: new Date().toISOString(),
    database: 'connected' as const,
    opencode: 'healthy' as const,
    opencodePort: 5551,
    opencodeVersion: null,
    opencodeMinVersion: '1.0.0',
    opencodeManagerVersion: null,
    error: undefined,
  }

  vi.mocked(useServerHealth).mockReturnValue({
    data: {
      ...baseHealth,
      ...health,
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    restartMutation: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    rollbackMutation: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
  })
}

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

const renderMoreDrawer = ({
  initialEntry = '/',
  routePath = '*',
  onClose = vi.fn(),
  scope = 'global',
}: {
  initialEntry?: string
  routePath?: string
  onClose?: () => void
  scope?: 'global' | 'project'
} = {}) => render(
  <QueryClientProvider client={createQueryClient()}>
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path={routePath} element={<MoreDrawer isOpen onClose={onClose} scope={scope} />} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>,
)

describe('MoreDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useNavigate).mockReturnValue(vi.fn())
    vi.mocked(getRepo).mockResolvedValue({
      id: 1,
      localPath: 'wrong-repo',
      fullPath: '/workspace/repos/wrong-repo',
      branch: 'main',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: 0,
    })
  })

  it('renders Settings and Logout menu items', () => {
    mockAuth()
    mockServerHealth()
    const handleClose = vi.fn()
    renderMoreDrawer({ onClose: handleClose })
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Logout')).toBeInTheDocument()
  })

  it('does not render theme controls', () => {
    mockAuth()
    mockServerHealth()
    const handleClose = vi.fn()
    renderMoreDrawer({ onClose: handleClose })
    expect(screen.queryByText('Theme')).not.toBeInTheDocument()
    expect(screen.queryByText('Light')).not.toBeInTheDocument()
    expect(screen.queryByText('Dark')).not.toBeInTheDocument()
    expect(screen.queryByText('System')).not.toBeInTheDocument()
  })

  it('navigates to settings when Settings is clicked', () => {
    const navigateMock = vi.fn()
    vi.mocked(useNavigate).mockReturnValue(navigateMock)
    mockAuth()
    mockServerHealth()
    const handleClose = vi.fn()
    renderMoreDrawer({ onClose: handleClose })
    fireEvent.click(screen.getByText('Settings'))
    expect(navigateMock).toHaveBeenCalledWith('/settings')
  })

  it('calls logout when Logout is clicked', () => {
    const logoutMock = vi.fn().mockResolvedValue(undefined)
    mockAuth(logoutMock)
    mockServerHealth()
    const handleClose = vi.fn()
    renderMoreDrawer({ onClose: handleClose })
    fireEvent.click(screen.getByText('Logout'))
    expect(logoutMock).toHaveBeenCalled()
  })

  it('displays OpenCode and Manager versions when available', () => {
    mockAuth()
    mockServerHealth({ opencodeVersion: '1.4.11', opencodeManagerVersion: '0.9.16' })
    const handleClose = vi.fn()
    renderMoreDrawer({ onClose: handleClose })
    expect(screen.getByText('v1.4.11 · Manager v0.9.16')).toBeInTheDocument()
  })

  it('shows unhealthy server status when server is unhealthy', () => {
    mockAuth()
    mockServerHealth({ opencode: 'unhealthy' as const, opencodeVersion: '1.4.11' })
    const handleClose = vi.fn()
    renderMoreDrawer({ onClose: handleClose })
    expect(screen.getByText('v1.4.11')).toBeInTheDocument()
  })

  it('shows fallback text when version is not available', () => {
    mockAuth()
    mockServerHealth({ opencodeVersion: null, opencodeManagerVersion: null })
    const handleClose = vi.fn()
    renderMoreDrawer({ onClose: handleClose })
    expect(screen.queryByText('OpenCode')).not.toBeInTheDocument()
  })

  /**
   * These two entries used to sit in this drawer, above Settings, even on a
   * conversation screen where they are the two things the composer needs. They
   * moved onto the conversation screen itself; SessionDetail's own test file
   * pins that they work there. Here the drawer pins that they left.
   */
  it('no longer offers conversation commands inside the drawer', () => {
    mockAuth()
    mockServerHealth()
    const handleClose = vi.fn()
    renderMoreDrawer({ initialEntry: '/repos/1/sessions/session-1', routePath: '/repos/:id/sessions/:sessionId', onClose: handleClose })

    expect(screen.queryByText('Commands')).not.toBeInTheDocument()
    expect(screen.queryByText('Mention File')).not.toBeInTheDocument()
  })

  it('still shows the settings entry it used to compete with', () => {
    mockAuth()
    mockServerHealth()
    const handleClose = vi.fn()
    renderMoreDrawer({ initialEntry: '/repos/1/sessions/session-1', routePath: '/repos/:id/sessions/:sessionId', onClose: handleClose })

    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('shows Assistant instead of the source repo on assistant routes', () => {
    mockAuth()
    mockServerHealth()
    const handleClose = vi.fn()
    renderMoreDrawer({ initialEntry: '/repos/1/assistant', routePath: '/repos/:id/assistant', onClose: handleClose, scope: 'project' })

    expect(screen.getAllByText('Assistant').length).toBeGreaterThan(0)
    expect(screen.queryByText('wrong-repo')).not.toBeInTheDocument()
  })

  it('shows Assistant instead of the source repo on canonical /assistant route', () => {
    mockAuth()
    mockServerHealth()
    const handleClose = vi.fn()
    renderMoreDrawer({ initialEntry: '/assistant', routePath: '/assistant', onClose: handleClose, scope: 'project' })

    expect(screen.getAllByText('Assistant').length).toBeGreaterThan(0)
    expect(screen.queryByText('wrong-repo')).not.toBeInTheDocument()
  })

  it('preserves session route as return target when opening schedules', () => {
    const navigateMock = vi.fn()
    vi.mocked(useNavigate).mockReturnValue(navigateMock)
    mockAuth()
    mockServerHealth()
    renderMoreDrawer({ initialEntry: '/repos/1/sessions/session-1?assistant=1', routePath: '/repos/:id/sessions/:sessionId', scope: 'project' })

    fireEvent.click(screen.getByText('Schedules'))

    expect(navigateMock).toHaveBeenCalledWith('/repos/1/schedules?returnTo=%2Frepos%2F1%2Fsessions%2Fsession-1%3Fassistant%3D1')
  })

  /**
   * The report this split answers: on a phone, the menu showed MCP, Skills,
   * Source Control, Schedules and Reset Permissions - five rows belonging to
   * the project - stacked above Projects, Assistant, Settings and Logout.
   *
   * Both halves are asserted on a session route, because that is where the two
   * used to be concatenated into one list. Asserting only the global half would
   * pass on a build that simply dropped the project tools.
   */
  it('keeps the project tools out of the global drawer, even on a session route', () => {
    mockAuth()
    mockServerHealth()
    renderMoreDrawer({
      initialEntry: '/repos/1/sessions/session-1',
      routePath: '/repos/:id/sessions/:sessionId',
      scope: 'global',
    })

    for (const label of ['MCP', 'Skills', 'Source Control', 'Reset Permissions']) {
      expect(screen.queryByText(label), label + ' leaked into the global menu').not.toBeInTheDocument()
    }
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Projects')).toBeInTheDocument()
  })

  it('keeps the global navigation out of the project drawer', () => {
    mockAuth()
    mockServerHealth()
    renderMoreDrawer({
      initialEntry: '/repos/1/sessions/session-1',
      routePath: '/repos/:id/sessions/:sessionId',
      scope: 'project',
    })

    for (const label of ['Skills', 'MCP', 'Source Control', 'Reset Permissions', 'Schedules']) {
      expect(screen.getByText(label), label + ' missing from the project menu').toBeInTheDocument()
    }
    for (const label of ['Settings', 'Logout', 'Files']) {
      expect(screen.queryByText(label), label + ' leaked into the project menu').not.toBeInTheDocument()
    }
  })

})
