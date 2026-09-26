import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DesktopSidebar } from './DesktopSidebar'
import * as useDesktopModule from '@/hooks/useDesktop'
import * as useSidebarCollapsedModule from '@/hooks/useSidebarCollapsed'
import * as useAuthModule from '@/hooks/useAuth'

vi.mock('@/hooks/useDesktop')
vi.mock('@/hooks/useSidebarCollapsed')
vi.mock('@/hooks/useAuth')

function LocationDisplay() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <div>
      <div data-testid="location">{location.pathname}{location.search}</div>
      <button onClick={() => navigate(-1)} data-testid="back-button">Back</button>
    </div>
  )
}

function createWrapper(initialEntries?: string[]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function mockAuth(user: { role?: string } = { role: 'user' }) {
  vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn(),
    user,
  } as any)
}

function mockDesktop(desktop: boolean) {
  vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(desktop)
  vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
}

describe('DesktopSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when user is not authenticated', () => {
    mockDesktop(false)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    const { container } = render(<DesktopSidebar />, { wrapper: createWrapper() })

    expect(container.firstChild).toBeNull()
  })

  it('returns null when auth state is loading', () => {
    mockDesktop(false)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: true,
      logout: vi.fn(),
    } as any)

    const { container } = render(<DesktopSidebar />, { wrapper: createWrapper() })

    expect(container.firstChild).toBeNull()
  })

  it('returns null when not desktop', () => {
    mockDesktop(false)
    mockAuth()

    const { container } = render(<DesktopSidebar />, { wrapper: createWrapper() })

    expect(container.firstChild).toBeNull()
  })

  it('renders the global rail', () => {
    mockDesktop(true)
    mockAuth()

    render(<DesktopSidebar />, { wrapper: createWrapper(['/']) })

    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(screen.getByText('Assistant')).toBeInTheDocument()
    expect(screen.getByText('Files')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Logout')).toBeInTheDocument()
  })

  it('hides the terminal for non-admins and shows it for admins', () => {
    mockDesktop(true)
    mockAuth({ role: 'user' })

    const { unmount } = render(<DesktopSidebar />, { wrapper: createWrapper(['/']) })
    expect(screen.queryByText('Terminal')).not.toBeInTheDocument()
    unmount()

    mockAuth({ role: 'admin' })
    render(<DesktopSidebar />, { wrapper: createWrapper(['/']) })
    expect(screen.getByText('Terminal')).toBeInTheDocument()
  })

  it('opens dialog items by updating the dialog query param (push) and closes on back', () => {
    mockDesktop(true)
    mockAuth()

    render(
      <>
        <DesktopSidebar />
        <LocationDisplay />
      </>,
      { wrapper: createWrapper(['/repos/5/sessions/abc?assistant=1']) }
    )

    fireEvent.click(screen.getByText('Files'))

    expect(screen.getByTestId('location').textContent).toBe('/repos/5/sessions/abc?assistant=1&dialog=files')

    fireEvent.click(screen.getByTestId('back-button'))

    expect(screen.getByTestId('location').textContent).toBe('/repos/5/sessions/abc?assistant=1')
  })

  it('opens settings by updating settings query params', () => {
    mockDesktop(true)
    mockAuth()

    render(
      <>
        <DesktopSidebar />
        <LocationDisplay />
      </>,
      { wrapper: createWrapper(['/?dialog=files']) }
    )

    fireEvent.click(screen.getByText('Settings'))

    expect(screen.getByTestId('location').textContent).toBe('/?dialog=files&settings=open&settingsTab=account')
  })

  it('navigates to the projects list', () => {
    mockDesktop(true)
    mockAuth()

    render(
      <>
        <DesktopSidebar />
        <LocationDisplay />
      </>,
      { wrapper: createWrapper(['/repos/5']) }
    )

    fireEvent.click(screen.getByText('Projects'))

    expect(screen.getByTestId('location').textContent).toBe('/')
  })
})
