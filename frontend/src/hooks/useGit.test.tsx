import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useGit } from './useGit'
import * as gitApi from '../api/git'
import * as toast from '../lib/toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { GitStatusResponse } from '../types/git'

vi.mock('../api/git', () => ({
  gitFetch: vi.fn(),
  gitPull: vi.fn(),
  gitPush: vi.fn(),
  gitCommit: vi.fn(),
  gitStageFiles: vi.fn(),
  gitUnstageFiles: vi.fn(),
  gitDiscardFiles: vi.fn(),
  gitReset: vi.fn(),
  fetchGitStatus: vi.fn(),
  fetchGitLog: vi.fn(),
  fetchGitDiff: vi.fn(),
  createBranch: vi.fn(),
  switchBranch: vi.fn(),
  getApiErrorMessage: vi.fn((error: unknown) => typeof error === 'string' ? error : String(error)),
}))
vi.mock('../lib/toast', () => ({
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    promise: vi.fn(),
    dismiss: vi.fn(),
  },
}))

const mockInvalidateQueries = vi.fn()
const mockSetQueryData = vi.fn()
const mockSetQueriesData = vi.fn()
const mockCancelQueries = vi.fn()
const mockGetQueryData = vi.fn()

const mockGitStatus: GitStatusResponse = {
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: [],
  hasChanges: false,
}

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query')
  return {
    ...actual,
    useQueryClient: vi.fn(() => ({
      invalidateQueries: mockInvalidateQueries,
      setQueryData: mockSetQueryData,
      setQueriesData: mockSetQueriesData,
      cancelQueries: mockCancelQueries,
      getQueryData: mockGetQueryData,
    }))
  }
})

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useGit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvalidateQueries.mockClear()
    // no cached status means nothing to guess at, which is what the rest of
    // this file relies on
    mockGetQueryData.mockReturnValue(undefined)
    mockCancelQueries.mockResolvedValue(undefined)
    vi.mocked(gitApi.gitFetch).mockResolvedValue(mockGitStatus)
    vi.mocked(gitApi.gitPull).mockResolvedValue(mockGitStatus)
    vi.mocked(gitApi.gitPush).mockResolvedValue(mockGitStatus)
    vi.mocked(gitApi.gitCommit).mockResolvedValue(mockGitStatus)
    vi.mocked(gitApi.gitStageFiles).mockResolvedValue(mockGitStatus)
    vi.mocked(gitApi.gitUnstageFiles).mockResolvedValue(mockGitStatus)
    vi.mocked(gitApi.gitDiscardFiles).mockResolvedValue(mockGitStatus)
    vi.mocked(gitApi.gitReset).mockResolvedValue(mockGitStatus)
    vi.mocked(gitApi.fetchGitStatus).mockResolvedValue(mockGitStatus)
  })

  const expectTargetedStatusCacheUpdate = () => {
    expect(mockSetQueryData).toHaveBeenCalledWith(['gitStatus', 1], mockGitStatus)
    expect(mockSetQueriesData).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['reposGitStatus'],
        predicate: expect.any(Function),
      }),
      expect.any(Function),
    )

    const [filters, updater] = mockSetQueriesData.mock.calls[0]
    expect(filters.predicate({ queryKey: ['reposGitStatus', [1, 2]] })).toBe(true)
    expect(filters.predicate({ queryKey: ['reposGitStatus', [2, 3]] })).toBe(false)
    expect(filters.predicate({ queryKey: ['other', [1]] })).toBe(false)

    const otherStatus = { ...mockGitStatus, branch: 'dev' }
    const oldData = new Map<number, GitStatusResponse>([[1, otherStatus], [2, otherStatus]])
    const updated = updater(oldData)
    expect(updated).not.toBe(oldData)
    expect(updated.get(1)).toBe(mockGitStatus)
    expect(updated.get(2)).toBe(otherStatus)
  }

  it('returns all mutations', () => {
    const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

    expect(result.current).toHaveProperty('fetch')
    expect(result.current).toHaveProperty('pull')
    expect(result.current).toHaveProperty('push')
    expect(result.current).toHaveProperty('commit')
    expect(result.current).toHaveProperty('stageFiles')
    expect(result.current).toHaveProperty('unstageFiles')
    expect(result.current).toHaveProperty('log')
    expect(result.current).toHaveProperty('diff')
  })

  describe('fetch mutation', () => {
    it('calls correct API and invalidates queries on success', async () => {
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.fetch.mutateAsync()
      })

      expect(gitApi.gitFetch).toHaveBeenCalledWith(1)
      expectTargetedStatusCacheUpdate()
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['reposGitStatus'] })
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['gitStatus', 1] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['fileDiff', 1] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitLog', 1] })
    })

    it('shows toast error on failure', async () => {
      const mockGitFetch = vi.mocked(gitApi.gitFetch)
      mockGitFetch.mockRejectedValue('Fetch failed')
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.fetch.mutateAsync().catch(() => {})
      })

      expect(toast.showToast.error).toHaveBeenCalledWith('Fetch failed')
    })
  })

  describe('pull mutation', () => {
    it('calls correct API and invalidates queries on success', async () => {
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.pull.mutateAsync()
      })

      expect(gitApi.gitPull).toHaveBeenCalledWith(1)
      expectTargetedStatusCacheUpdate()
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['reposGitStatus'] })
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['gitStatus', 1] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['fileDiff', 1] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitLog', 1] })
    })

    it('shows toast error on failure', async () => {
      const mockGitPull = vi.mocked(gitApi.gitPull)
      mockGitPull.mockRejectedValue('Pull failed')
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.pull.mutateAsync().catch(() => {})
      })

      expect(toast.showToast.error).toHaveBeenCalledWith('Pull failed')
    })
  })

  describe('push mutation', () => {
    it('calls correct API and invalidates queries on success', async () => {
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.push.mutateAsync(undefined)
      })

      expect(gitApi.gitPush).toHaveBeenCalledWith(1, false)
      expectTargetedStatusCacheUpdate()
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['reposGitStatus'] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['fileDiff', 1] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitLog', 1] })
    })

    it('shows toast error on failure', async () => {
      const mockGitPush = vi.mocked(gitApi.gitPush)
      mockGitPush.mockRejectedValue('Push failed')
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.push.mutateAsync(undefined).catch(() => {})
      })

      expect(toast.showToast.error).toHaveBeenCalledWith('Push failed')
    })
  })

  describe('commit mutation', () => {
    it('calls correct API and invalidates queries on success', async () => {
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.commit.mutateAsync({ message: 'test commit' })
      })

      expect(gitApi.gitCommit).toHaveBeenCalledWith(1, 'test commit', undefined)
      expectTargetedStatusCacheUpdate()
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['reposGitStatus'] })
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['gitStatus', 1] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['fileDiff', 1] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitLog', 1] })
    })

    it('shows toast error on failure', async () => {
      const mockGitCommit = vi.mocked(gitApi.gitCommit)
      mockGitCommit.mockRejectedValue('Commit failed')
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.commit.mutateAsync({ message: 'test' }).catch(() => {})
      })

      expect(toast.showToast.error).toHaveBeenCalledWith('Commit failed')
    })
  })

  describe('stageFiles mutation', () => {
    it('calls correct API and invalidates queries on success', async () => {
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.stageFiles.mutateAsync(['file.txt'])
      })

      expect(gitApi.gitStageFiles).toHaveBeenCalledWith(1, ['file.txt'])
      expectTargetedStatusCacheUpdate()
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['reposGitStatus'] })
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['gitStatus', 1] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['fileDiff', 1] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitLog', 1] })
    })

    it('shows toast error on failure', async () => {
      const mockGitStageFiles = vi.mocked(gitApi.gitStageFiles)
      mockGitStageFiles.mockRejectedValue('Stage failed')
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.stageFiles.mutateAsync(['file.txt']).catch(() => {})
      })

      expect(toast.showToast.error).toHaveBeenCalledWith('Stage failed')
    })
  })

  describe('unstageFiles mutation', () => {
    it('calls correct API and invalidates queries on success', async () => {
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.unstageFiles.mutateAsync(['file.txt'])
      })

      expect(gitApi.gitUnstageFiles).toHaveBeenCalledWith(1, ['file.txt'])
      expectTargetedStatusCacheUpdate()
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['reposGitStatus'] })
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['gitStatus', 1] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['fileDiff', 1] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitLog', 1] })
    })

    it('shows toast error on failure', async () => {
      const mockGitUnstageFiles = vi.mocked(gitApi.gitUnstageFiles)
      mockGitUnstageFiles.mockRejectedValue('Unstage failed')
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.unstageFiles.mutateAsync(['file.txt']).catch(() => {})
      })

      expect(toast.showToast.error).toHaveBeenCalledWith('Unstage failed')
    })
  })

  describe('optimistic file-list writes', () => {
    const withFiles: GitStatusResponse = {
      branch: 'main',
      ahead: 0,
      behind: 0,
      files: [
        { path: 'a.txt', status: 'modified', staged: false },
        { path: 'b.txt', status: 'modified', staged: true },
      ],
      hasChanges: true,
    }

    // every cache write goes through setQueryData(['gitStatus', 1], data)
    const statusWrites = () =>
      mockSetQueryData.mock.calls
        .filter((call) => call[0][0] === 'gitStatus')
        .map((call) => call[1] as GitStatusResponse)

    it('moves the file locally before the server answers', async () => {
      mockGetQueryData.mockReturnValue(withFiles)
      let release!: (value: GitStatusResponse) => void
      vi.mocked(gitApi.gitStageFiles).mockReturnValue(new Promise((r) => { release = r }))

      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })
      result.current.stageFiles.mutate(['a.txt'])

      await waitFor(() => expect(statusWrites().length).toBeGreaterThan(0))
      const local = statusWrites().at(-1)!
      expect(local.files.map((f) => f.staged)).toEqual([true, true])
      // the request is still in flight at this point
      expect(gitApi.gitStageFiles).toHaveBeenCalled()
      release(mockGitStatus)
    })

    it('puts the previous status back when staging fails', async () => {
      mockGetQueryData.mockReturnValue(withFiles)
      vi.mocked(gitApi.gitStageFiles).mockRejectedValue('nope')

      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })
      await result.current.stageFiles.mutateAsync(['a.txt']).catch(() => {})

      // the last thing written must be the untouched snapshot
      expect(statusWrites().at(-1), 'rollback must be the last write').toBe(withFiles)
      expect(toast.showToast.error).toHaveBeenCalledWith('nope')
    })

    it('unstages locally and rolls back the same way', async () => {
      mockGetQueryData.mockReturnValue(withFiles)
      let release!: (value: GitStatusResponse) => void
      vi.mocked(gitApi.gitUnstageFiles).mockReturnValue(new Promise((r) => { release = r }))

      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })
      result.current.unstageFiles.mutate(['b.txt'])

      await waitFor(() => expect(statusWrites().length).toBeGreaterThan(0))
      expect(statusWrites().at(-1)!.files.map((f) => f.staged)).toEqual([false, false])
      release(mockGitStatus)
    })

    it('drops the file locally and can bring it back', async () => {
      mockGetQueryData.mockReturnValue(withFiles)
      let release!: (value: GitStatusResponse) => void
      vi.mocked(gitApi.gitDiscardFiles).mockReturnValue(new Promise((r) => { release = r }))

      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })
      result.current.discardFiles.mutate({ paths: ['a.txt'], staged: false })

      await waitFor(() => expect(statusWrites().length).toBeGreaterThan(0))
      const local = statusWrites().at(-1)!
      expect(local.files.map((f) => f.path)).toEqual(['b.txt'])
      expect(local.hasChanges).toBe(true)
      release(mockGitStatus)
    })

    it('emptying the list flips hasChanges so the empty state shows', async () => {
      mockGetQueryData.mockReturnValue(withFiles)
      let release!: (value: GitStatusResponse) => void
      vi.mocked(gitApi.gitDiscardFiles).mockReturnValue(new Promise((r) => { release = r }))

      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })
      result.current.discardFiles.mutate({ paths: ['a.txt', 'b.txt'], staged: false })

      await waitFor(() => expect(statusWrites().length).toBeGreaterThan(0))
      const local = statusWrites().at(-1)!
      expect(local.files).toEqual([])
      expect(local.hasChanges).toBe(false)
      release(mockGitStatus)
    })

    it('does not guess when there is no cached status to guess from', async () => {
      mockGetQueryData.mockReturnValue(undefined)
      vi.mocked(gitApi.gitStageFiles).mockResolvedValue(mockGitStatus)

      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })
      await result.current.stageFiles.mutateAsync(['a.txt'])

      // only the server's own answer may be written
      expect(statusWrites()).toEqual([mockGitStatus])
    })

    it('stops an in-flight refetch from stomping the local guess', async () => {
      mockGetQueryData.mockReturnValue(withFiles)
      let release!: (value: GitStatusResponse) => void
      vi.mocked(gitApi.gitStageFiles).mockReturnValue(new Promise((r) => { release = r }))

      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })
      result.current.stageFiles.mutate(['a.txt'])

      await waitFor(() => expect(mockCancelQueries).toHaveBeenCalled())
      expect(mockCancelQueries).toHaveBeenCalledWith({ queryKey: ['gitStatus', 1] })
      expect(mockCancelQueries).toHaveBeenCalledWith({ queryKey: ['reposGitStatus'] })
      release(mockGitStatus)
    })
  })
})
