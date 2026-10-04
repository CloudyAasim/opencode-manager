import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RepoList } from './RepoList'

const mockDeleteRepo = vi.fn()
const mockListRepos = vi.fn()

vi.mock('@/api/repos', () => ({
  listRepos: () => mockListRepos(),
  deleteRepo: (id: number) => mockDeleteRepo(id),
  updateRepoOrder: vi.fn(async () => undefined),
}))

vi.mock('@/api/git', () => ({
  // A Map, not an object: buildRepoViewModels calls .get on it.
  fetchReposGitStatus: vi.fn(async () => new Map()),
}))

vi.mock('@/lib/toast', () => ({
  showToast: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}))

// Partial: the dialog this test opens also imports useSwipeBack from here.
vi.mock('@/hooks/useMobile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useMobile')>()),
  useMobile: () => false,
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    getSettings: vi.fn(async () => ({
      preferences: { repoOrder: [], gitCredentials: [] },
      updatedAt: 0,
    })),
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
  },
}))

// The real card is a large surface; all this test needs is the two entry
// points it hands down.
vi.mock('./RepoCard', () => ({
  RepoCard: ({
    repo,
    onDelete,
    onSelect,
    isSelected,
  }: {
    repo: { id: number }
    onDelete: (id: number) => void
    onSelect: (id: number, selected: boolean) => void
    isSelected: boolean
  }) => (
    <div>
      <button onClick={() => onDelete(repo.id)}>delete-repo-{repo.id}</button>
      <button onClick={() => onSelect(repo.id, !isSelected)}>select-repo-{repo.id}</button>
    </div>
  ),
}))

import { showToast } from '@/lib/toast'

const REPOS = [
  {
    id: 7,
    name: 'demo',
    localPath: '/repos/demo',
    fullPath: '/repos/demo',
    cloneStatus: 'ready' as const,
    isWorktree: false,
    isLocal: false,
  },
  {
    id: 8,
    name: 'other',
    localPath: '/repos/other',
    fullPath: '/repos/other',
    cloneStatus: 'ready' as const,
    isWorktree: false,
    isLocal: false,
  },
]

function renderList() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RepoList />
    </QueryClientProvider>,
  )
}

async function confirmDeleteOn(repoId: number) {
  await waitFor(() => expect(screen.getByText(`delete-repo-${repoId}`)).toBeInTheDocument())
  fireEvent.click(screen.getByText(`delete-repo-${repoId}`))
  const confirm = await screen.findByRole('button', { name: 'Delete' })
  fireEvent.click(confirm)
}

describe('删除项目时聊天记录没清干净', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListRepos.mockResolvedValue(REPOS)
    mockDeleteRepo.mockResolvedValue({ success: true, sessionsDeleted: 2, sessionsPurgeIncomplete: false })
  })

  it('清除干净时不打扰用户', async () => {
    renderList()
    await confirmDeleteOn(7)

    await waitFor(() => expect(mockDeleteRepo).toHaveBeenCalledWith(7))
    expect(showToast.warning).not.toHaveBeenCalled()
  })

  it('没清干净就明说,而不是安静地把项目删掉', async () => {
    mockDeleteRepo.mockResolvedValue({ success: true, sessionsDeleted: 1, sessionsPurgeIncomplete: true })

    renderList()
    await confirmDeleteOn(7)

    await waitFor(() => expect(showToast.warning).toHaveBeenCalled())
    expect(vi.mocked(showToast.warning).mock.calls[0]?.[0]).toBe('Conversations were not cleared')
    // The count is projects whose conversations survived, not conversations.
    expect(vi.mocked(showToast.warning).mock.calls[0]?.[1]).toMatchObject({
      description: 'Conversations could not be cleared for 1 repository. They may reappear if you add that project again.',
    })
  })

  it('项目照样被删除 —— 用户要的是删除,聊天没清干净不是拦路的理由', async () => {
    mockDeleteRepo.mockResolvedValue({ success: true, sessionsDeleted: 0, sessionsPurgeIncomplete: true })

    renderList()
    await confirmDeleteOn(7)

    await waitFor(() => expect(showToast.warning).toHaveBeenCalled())
    expect(mockDeleteRepo).toHaveBeenCalledWith(7)
    expect(vi.mocked(showToast.error)).not.toHaveBeenCalled()
  })

  it('旧后端不返回这个字段时不误报', async () => {
    // A backend that predates the field simply omits it. `undefined` has to
    // read as "nothing to report", not as "something went wrong".
    mockDeleteRepo.mockResolvedValue({ success: true })

    renderList()
    await confirmDeleteOn(7)

    await waitFor(() => expect(mockDeleteRepo).toHaveBeenCalledWith(7))
    expect(showToast.warning).not.toHaveBeenCalled()
  })

  it('批量删除里只要有一个没清干净就要说,而且说的是项目个数不是聊天条数', async () => {
    mockDeleteRepo
      .mockResolvedValueOnce({ success: true, sessionsDeleted: 5, sessionsPurgeIncomplete: false })
      .mockResolvedValueOnce({ success: true, sessionsDeleted: 0, sessionsPurgeIncomplete: true })

    renderList()

    await waitFor(() => expect(screen.getByText('select-repo-7')).toBeInTheDocument())
    fireEvent.click(screen.getByText('select-repo-7'))
    fireEvent.click(screen.getByText('select-repo-8'))

    // The selection bar's trigger and the dialog's confirm share a label, so
    // only one of them exists at this point.
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!)

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(mockDeleteRepo).toHaveBeenCalledTimes(2))
    expect(vi.mocked(showToast.warning).mock.calls[0]?.[1]).toMatchObject({
      description: 'Conversations could not be cleared for 1 repository. They may reappear if you add that project again.',
    })
  })

  it('批量删除全部清干净时不打扰用户', async () => {
    mockDeleteRepo.mockResolvedValue({ success: true, sessionsDeleted: 1, sessionsPurgeIncomplete: false })

    renderList()

    await waitFor(() => expect(screen.getByText('select-repo-7')).toBeInTheDocument())
    fireEvent.click(screen.getByText('select-repo-7'))
    fireEvent.click(screen.getByText('select-repo-8'))

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!)

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(mockDeleteRepo).toHaveBeenCalledTimes(2))
    expect(showToast.warning).not.toHaveBeenCalled()
  })
})
