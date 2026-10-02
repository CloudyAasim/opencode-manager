import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createRepoWorkspace, deleteRepoWorkspace, getRepoSiblings, type RepoSibling } from '@/api/repos'
import { showToast } from '@/lib/toast'
import { useI18n } from '@/lib/i18n'

export function useRepoSiblings(repoId: number | undefined) {
  return useQuery<RepoSibling[]>({
    queryKey: ['repo', 'siblings', repoId],
    queryFn: () => getRepoSiblings(repoId!),
    enabled: !!repoId && repoId > 0,
    staleTime: 30_000,
  })
}

export function useDeleteRepoWorkspaces(repoId: number | undefined) {
  const queryClient = useQueryClient()
  const { t } = useI18n()

  return useMutation({
    mutationFn: async (workspaceIds: string[]) => {
      if (!repoId) throw new Error('Repo id is required')
      const results = await Promise.allSettled(
        workspaceIds.map((workspaceId) => deleteRepoWorkspace(repoId, workspaceId)),
      )
      const failed = results.filter((result) => result.status === 'rejected').length
      return { total: workspaceIds.length, failed }
    },
    onSuccess: ({ total, failed }) => {
      queryClient.invalidateQueries({ queryKey: ['repo', 'siblings', repoId] })
      const deleted = total - failed
      if (failed === 0) {
        showToast.success(deleted === 1 ? 'Workspace deleted' : `${deleted} workspaces deleted`)
      } else if (deleted === 0) {
        showToast.error(t('repo.workspaceManager.deleteFailed'))
      } else {
        showToast.error(t('repo.workspaceManager.deletePartial', { deleted, failed }))
      }
    },
    onError: () => {
      showToast.error(t('repo.workspaceManager.deleteFailed'))
    },
  })
}

export function useCreateRepoWorkspace(repoId: number | undefined) {
  const queryClient = useQueryClient()
  const { t } = useI18n()

  return useMutation({
    mutationFn: async () => {
      if (!repoId) throw new Error('Repo id is required')
      return createRepoWorkspace(repoId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repo', 'siblings', repoId] })
      showToast.success(t('repo.workspaceManager.created'))
    },
    onError: () => {
      showToast.error(t('repo.workspaceManager.createFailed'))
    },
  })
}
