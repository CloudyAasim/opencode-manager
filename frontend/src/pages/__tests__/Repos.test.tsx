import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { LayerProvider } from '@/framework/layer/LayerProvider'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Repos } from '../Repos'

vi.mock('@/features/repos/RepoList', () => ({ RepoList: () => <div data-testid="repo-list" /> }))
vi.mock('@/features/repos/AddRepoDialog', () => ({ AddRepoDialog: () => null }))
vi.mock('@/features/file-browser/FileBrowserSheet', () => ({ FileBrowserSheet: () => null }))
vi.mock('@/components/notifications/PendingActionsGroup', () => ({ PendingActionsGroup: () => null }))

function LocationSpy() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LayerProvider>{children}</LayerProvider>
      </MemoryRouter>
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
