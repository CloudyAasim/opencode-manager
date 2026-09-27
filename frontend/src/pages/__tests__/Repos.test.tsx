import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Repos } from '../Repos'

vi.mock('@/components/repo/RepoList', () => ({ RepoList: () => <div data-testid="repo-list" /> }))
vi.mock('@/components/repo/AddRepoDialog', () => ({ AddRepoDialog: () => null }))
vi.mock('@/components/file-browser/FileBrowserSheet', () => ({ FileBrowserSheet: () => null }))
vi.mock('@/components/notifications/PendingActionsGroup', () => ({ PendingActionsGroup: () => null }))

function LocationSpy() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('Repos page', () => {
  it('renders the project list and an assistant entry', () => {
    render(<Repos />, { wrapper })

    expect(screen.getByTestId('repo-list')).toBeInTheDocument()
    expect(screen.getByText('Assistant')).toBeInTheDocument()
  })

  it('opens the assistant workspace from its card', () => {
    render(
      <>
        <Repos />
        <LocationSpy />
      </>,
      { wrapper },
    )

    fireEvent.click(screen.getByRole('button', { name: /Assistant/ }))

    expect(screen.getByTestId('location').textContent).toBe('/assistant')
  })
})
