import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProjectInfoPanel } from './ProjectInfoPanel'

const fetchGitStatus = vi.hoisted(() => vi.fn())
const fetchGitLog = vi.hoisted(() => vi.fn())

vi.mock('@/api/git', () => ({ fetchGitStatus, fetchGitLog }))

beforeEach(() => {
  fetchGitStatus.mockReset()
  fetchGitLog.mockReset()
})

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('ProjectInfoPanel', () => {
  it('shows git status and recent commits for a project', async () => {
    fetchGitStatus.mockResolvedValue({ branch: 'main', ahead: 1, behind: 0, files: [{ path: 'a' }, { path: 'b' }], hasChanges: true })
    fetchGitLog.mockResolvedValue({
      commits: [{ hash: 'abcdef1234', message: 'first line\nsecond line', authorName: 'a', authorEmail: 'a@b', date: '' }],
    })

    render(
      <ProjectInfoPanel repoId={1} name="demo" directory="/workspace/demo" branch="dev" />,
      { wrapper },
    )

    expect(screen.getByText('demo')).toBeInTheDocument()
    expect(screen.getByText('/workspace/demo')).toBeInTheDocument()
    expect(await screen.findByText('main')).toBeInTheDocument()
    expect(await screen.findByText('2')).toBeInTheDocument()
    expect(await screen.findByText('first line')).toBeInTheDocument()
    expect(await screen.findByText('abcdef1')).toBeInTheDocument()
  })

  it('skips git sections for the assistant repository (id 0)', async () => {
    render(
      <ProjectInfoPanel repoId={0} name="Assistant" directory="/workspace/assistant" />,
      { wrapper },
    )

    expect(screen.getByText('Assistant')).toBeInTheDocument()
    expect(screen.queryByText('Recent commits')).not.toBeInTheDocument()
    expect(screen.queryByText('Changes')).not.toBeInTheDocument()
    expect(fetchGitStatus).not.toHaveBeenCalled()
    expect(fetchGitLog).not.toHaveBeenCalled()
  })

  it('shortens the directory to the space the user navigates by', () => {
    // The panel is the one place a project's absolute path is spelled out in
    // full, and on disk that path carries the account name and the internal
    // layout. The name is the part worth keeping out of the interface.
    render(
      <ProjectInfoPanel
        repoId={0}
        name="demo"
        directory="/workspace/users/aasim/workspace/repos/RelayAB"
      />,
      { wrapper },
    )

    // Positive: the directory is rendered, shortened, and the real project is
    // still identifiable in it.
    expect(screen.getByText('/workspace/repos/RelayAB')).toBeInTheDocument()
    // Reverse: the host layout is not printed.
    expect(screen.queryByText('/workspace/users/aasim/workspace/repos/RelayAB')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('users/aasim')
  })

  it('leaves a directory outside the managed roots spelled as it is', () => {
    // `toDisplayPath` only rewrites the two roots the user actually navigates
    // by. Inventing a shorter form for anything else would be showing a path
    // that does not exist.
    render(
      <ProjectInfoPanel repoId={0} name="demo" directory="/opt/other/projects" />,
      { wrapper },
    )

    expect(screen.getByText('/opt/other/projects')).toBeInTheDocument()
    expect(screen.getByText('demo')).toBeInTheDocument()
  })
})
