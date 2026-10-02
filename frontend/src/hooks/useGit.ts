import { useMutation, useQueryClient } from '@tanstack/react-query'
import { gitFetch, gitPull, gitPush, gitCommit, gitStageFiles, gitUnstageFiles, gitDiscardFiles, fetchGitLog, fetchGitDiff, gitReset, getApiErrorMessage, fetchGitStatus } from '@/api/git'
import { createBranch, switchBranch } from '@/api/repos'
import { showToast } from '@/lib/toast'
import {
  cancelRepoGitStatus,
  getRepoGitStatus,
  invalidateRepoGitCaches,
  setRepoGitStatusCaches,
} from '@/lib/queryInvalidation'
import { withStagedPaths, withoutPaths } from '@/lib/gitStatus'
import { useI18n } from '@/lib/i18n'

export function useGit(repoId: number | undefined, onError?: (error: unknown) => void) {
  const queryClient = useQueryClient()
  const { t } = useI18n()

  const handleError = (error: unknown) => {
    if (onError) {
      onError(error)
    } else {
      showToast.error(getApiErrorMessage(error))
    }
  }

  const fetch = useMutation({
    mutationFn: () => {
      if (!repoId) throw new Error('No repo ID')
      return gitFetch(repoId)
    },
    onSuccess: (data) => {
      if (repoId) setRepoGitStatusCaches(queryClient, repoId, data)
      invalidateRepoGitCaches(queryClient, repoId, { invalidateStatus: false })
      showToast.success(t('misc.sourceControl.fetchCompleted'))
    },
    onError: handleError,
  })

  const pull = useMutation({
    mutationFn: () => {
      if (!repoId) throw new Error('No repo ID')
      return gitPull(repoId)
    },
    onSuccess: (data) => {
      if (repoId) setRepoGitStatusCaches(queryClient, repoId, data)
      invalidateRepoGitCaches(queryClient, repoId, { invalidateStatus: false })
      showToast.success(t('misc.sourceControl.pullCompleted'))
    },
    onError: handleError,
  })

  const push = useMutation({
    mutationFn: (options?: { setUpstream?: boolean }) => {
      if (!repoId) throw new Error('No repo ID')
      return gitPush(repoId, options?.setUpstream ?? false)
    },
    onSuccess: (data) => {
      if (repoId) setRepoGitStatusCaches(queryClient, repoId, data)
      invalidateRepoGitCaches(queryClient, repoId, { invalidateStatus: false, invalidateRepoMeta: false })
      showToast.success(t('misc.sourceControl.pushCompleted'))
    },
    onError: handleError,
  })

  const commit = useMutation({
    mutationFn: ({ message, stagedPaths }: { message: string; stagedPaths?: string[] }) => {
      if (!repoId) throw new Error('No repo ID')
      return gitCommit(repoId, message, stagedPaths)
    },
    onSuccess: (data) => {
      if (repoId) setRepoGitStatusCaches(queryClient, repoId, data)
      invalidateRepoGitCaches(queryClient, repoId, { invalidateStatus: false, invalidateRepoMeta: false })
      showToast.success(t('misc.sourceControl.commitCreated'))
    },
    onError: handleError,
  })

  const stageFilesMutation = useMutation({
    mutationFn: (paths: string[]) => {
      if (!repoId) throw new Error('No repo ID')
      return gitStageFiles(repoId, paths)
    },
    onMutate: async (paths) => {
      if (!repoId) return { previous: undefined }
      await cancelRepoGitStatus(queryClient, repoId)
      const previous = getRepoGitStatus(queryClient, repoId)
      if (previous) {
        setRepoGitStatusCaches(queryClient, repoId, withStagedPaths(previous, paths, true))
      }
      return { previous }
    },
    onError: (error, _paths, context) => {
      if (context?.previous) setRepoGitStatusCaches(queryClient, repoId!, context.previous)
      handleError(error)
    },
    onSuccess: (data) => {
      if (repoId) setRepoGitStatusCaches(queryClient, repoId, data)
      invalidateRepoGitCaches(queryClient, repoId, { invalidateStatus: false, invalidateRepoMeta: false })
      showToast.success(t('misc.sourceControl.filesStaged'))
    },
  })

  const unstageFilesMutation = useMutation({
    mutationFn: (paths: string[]) => {
      if (!repoId) throw new Error('No repo ID')
      return gitUnstageFiles(repoId, paths)
    },
    onMutate: async (paths) => {
      if (!repoId) return { previous: undefined }
      await cancelRepoGitStatus(queryClient, repoId)
      const previous = getRepoGitStatus(queryClient, repoId)
      if (previous) {
        setRepoGitStatusCaches(queryClient, repoId, withStagedPaths(previous, paths, false))
      }
      return { previous }
    },
    onError: (error, _paths, context) => {
      if (context?.previous) setRepoGitStatusCaches(queryClient, repoId!, context.previous)
      handleError(error)
    },
    onSuccess: (data) => {
      if (repoId) setRepoGitStatusCaches(queryClient, repoId, data)
      invalidateRepoGitCaches(queryClient, repoId, { invalidateStatus: false, invalidateRepoMeta: false })
      showToast.success(t('misc.sourceControl.filesUnstaged'))
    },
  })

  const discardFilesMutation = useMutation({
    mutationFn: ({ paths, staged }: { paths: string[]; staged: boolean }) => {
      if (!repoId) throw new Error('No repo ID')
      return gitDiscardFiles(repoId, paths, staged)
    },
    onMutate: async ({ paths }) => {
      if (!repoId) return { previous: undefined }
      await cancelRepoGitStatus(queryClient, repoId)
      const previous = getRepoGitStatus(queryClient, repoId)
      if (previous) {
        setRepoGitStatusCaches(queryClient, repoId, withoutPaths(previous, paths))
      }
      return { previous }
    },
    onError: (error, _variables, context) => {
      if (context?.previous) setRepoGitStatusCaches(queryClient, repoId!, context.previous)
      handleError(error)
    },
    onSuccess: (data) => {
      if (repoId) setRepoGitStatusCaches(queryClient, repoId, data)
      invalidateRepoGitCaches(queryClient, repoId, { invalidateStatus: false, invalidateRepoMeta: false })
    },
  })

  const log = useMutation({
    mutationFn: ({ limit }: { limit?: number }) => {
      if (!repoId) throw new Error('No repo ID')
      return fetchGitLog(repoId, limit)
    },
    onError: handleError,
  })

  const diff = useMutation({
    mutationFn: (path: string) => {
      if (!repoId) throw new Error('No repo ID')
      return fetchGitDiff(repoId, path)
    },
    onError: handleError,
  })

  const createBranchMutation = useMutation({
    mutationFn: async (branchName: string) => {
      if (!repoId) throw new Error('No repo ID')
      await createBranch(repoId, branchName)
      return fetchGitStatus(repoId)
    },
    onSuccess: (data) => {
      if (repoId) setRepoGitStatusCaches(queryClient, repoId, data)
      invalidateRepoGitCaches(queryClient, repoId, { invalidateStatus: false })
      showToast.success(t('misc.branches.created'))
    },
    onError: handleError,
  })

  const switchBranchMutation = useMutation({
    mutationFn: async (branchName: string) => {
      if (!repoId) throw new Error('No repo ID')
      await switchBranch(repoId, branchName)
      return fetchGitStatus(repoId)
    },
    onSuccess: (data, variables) => {
      if (repoId) setRepoGitStatusCaches(queryClient, repoId, data)
      invalidateRepoGitCaches(queryClient, repoId, { invalidateStatus: false })
      showToast.success(t('misc.branches.switched', { branch: variables }))
    },
    onError: handleError,
  })

  const resetMutation = useMutation({
    mutationFn: (commitHash: string) => {
      if (!repoId) throw new Error('No repo ID')
      return gitReset(repoId, commitHash)
    },
    onSuccess: (data) => {
      if (repoId) setRepoGitStatusCaches(queryClient, repoId, data)
      invalidateRepoGitCaches(queryClient, repoId, { invalidateStatus: false, invalidateRepoMeta: false })
      showToast.success(t('misc.sourceControl.resetToCommit'))
    },
    onError: handleError,
  })

  return {
    fetch,
    pull,
    push,
    commit,
    stageFiles: stageFilesMutation,
    unstageFiles: unstageFilesMutation,
    discardFiles: discardFilesMutation,
    log,
    diff,
    createBranch: createBranchMutation,
    switchBranch: switchBranchMutation,
    reset: resetMutation
  }
}
