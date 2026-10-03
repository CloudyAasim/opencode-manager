import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LayerProvider } from '@/framework/layer/LayerProvider'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Repos } from '../Repos'

vi.mock('@/features/repos/RepoList', () => ({ RepoList: () => <div data-testid="repo-list" /> }))
vi.mock('@/features/repos/AddRepoDialog', () => ({ AddRepoDialog: () => null }))
vi.mock('@/features/file-browser/FileBrowserSheet', () => ({ FileBrowserSheet: () => null }))
vi.mock('@/features/notifications/PendingActionsGroup', () => ({ PendingActionsGroup: () => null }))


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
  it('renders the project list and no assistant card', () => {
    // The assistant used to have a card here, next to the project list. It is
    // reached from the top bar now, and a card on this page was a second way
    // to the same place.
    render(<Repos />, { wrapper })

    expect(screen.getByTestId('repo-list')).toBeInTheDocument()
    expect(screen.queryByText('Assistant')).not.toBeInTheDocument()
  })

  it('offers no settings button either', () => {
    render(<Repos />, { wrapper })

    expect(
      screen.queryByRole('button', { name: /settings|设置/i }),
    ).not.toBeInTheDocument()
  })
})
