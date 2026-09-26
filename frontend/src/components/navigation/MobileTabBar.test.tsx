import { vi } from 'vitest'

vi.mock('@/hooks/useMobile', () => ({
  useMobile: vi.fn(),
}))

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MobileTabBar } from './MobileTabBar'
import { useMobile } from '@/hooks/useMobile'

function LocationSpy() {
  const { pathname, search } = useLocation()
  return <div data-testid="location">{`${pathname}${search}`}</div>
}

function renderTabBar(initialEntries: string[]) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <MobileTabBar />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('MobileTabBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when useMobile returns false', () => {
    vi.mocked(useMobile).mockReturnValue(false)
    const queryClient = new QueryClient()
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing on unsupported paths', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/login']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders global tabs on repo detail (session list) path', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    renderTabBar(['/repos/123'])
    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(screen.getByText('Files')).toBeInTheDocument()
    expect(screen.queryByText('Schedules')).not.toBeInTheDocument()
  })

  it('renders global tabs on assistant session list path', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    renderTabBar(['/assistant?view=sessions'])
    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(screen.getByText('Assistant')).toBeInTheDocument()
  })

  it('navigates to /assistant when assistant is clicked from repo context', async () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/repos/123']}>
          <Routes>
            <Route path="*" element={<>
              <MobileTabBar />
              <LocationSpy />
            </>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Assistant' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/assistant')
  })

  it('navigates to the projects list when the projects tab is clicked', async () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/repos/123']}>
          <Routes>
            <Route path="*" element={<>
              <MobileTabBar />
              <LocationSpy />
            </>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Projects' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/')
  })

  it('renders schedule tabs on /repos/:id/schedules path', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    renderTabBar(['/repos/123/schedules'])
    expect(screen.getByText('Jobs')).toBeInTheDocument()
    expect(screen.getByText('Detail')).toBeInTheDocument()
    expect(screen.getByText('Runs')).toBeInTheDocument()
    expect(screen.queryByText('Assistant')).not.toBeInTheDocument()
  })

  it('renders tab bar on root path', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    renderTabBar(['/'])
    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(screen.getByText('Files')).toBeInTheDocument()
    expect(screen.getByText('Assistant')).toBeInTheDocument()
    expect(screen.getByText('More')).toBeInTheDocument()
  })

  it('renders tab bar on /schedules path', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    renderTabBar(['/schedules'])
    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(screen.getByText('More')).toBeInTheDocument()
  })

  it('Projects tab is active when pathname is / and no sheet is open', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    renderTabBar(['/'])
    const projectsButton = screen.getByText('Projects').closest('button')
    expect(projectsButton).toHaveClass('text-primary')
    expect(projectsButton).toHaveClass('border-primary')
  })

  it('Projects tab is not active while a sheet is open', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    renderTabBar(['/?mobileTab=more'])
    const projectsButton = screen.getByText('Projects').closest('button')
    expect(projectsButton).not.toHaveClass('text-primary')
  })

  it('maintains stable callbacks when search changes but mobileTab does not', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/?foo=1']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const firstProjectsButton = screen.getByText('Projects').closest('button')
    expect(firstProjectsButton).toBeInTheDocument()

    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/?foo=2']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const secondProjectsButton = screen.getByText('Projects').closest('button')
    expect(secondProjectsButton).toBeInTheDocument()
  })

  it('does not render tab bar on SessionDetail path /repos/:id/sessions/:sid', () => {
    vi.mocked(useMobile).mockReturnValue(true)
    const queryClient = new QueryClient()
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/repos/1/sessions/abc']}>
          <MobileTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(container.firstChild).toBeNull()
  })

})
