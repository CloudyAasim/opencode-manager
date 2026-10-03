import { useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getAssistantModeStatus,
  initializeAssistantMode,
} from '@/api/repos'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import type { AssistantModeStatus, AssistantModeInitRequest } from '@opencode-manager/shared/types'

export function useAssistantMode(repoId?: number) {
  const queryClient = useQueryClient()

  const statusQuery = useQuery<AssistantModeStatus>({
    queryKey: ['assistant-mode'],
    queryFn: () => getAssistantModeStatus(ASSISTANT_REPO_ID),
    enabled: repoId === ASSISTANT_REPO_ID,
  })

  const initializeMutation = useMutation({
    mutationFn: (options?: AssistantModeInitRequest) =>
      initializeAssistantMode(ASSISTANT_REPO_ID, options),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['assistant-mode'],
      })
    },
  })

  // mutateAsync insists on its variable even though the request body is
  // optional. Depending on the whole mutation result instead would be a lie:
  // that object is new every render, so any effect that calls initialize would
  // re-fire on every render. The function itself is the stable one.
  const { mutateAsync: runInitialize } = initializeMutation
  const initialize = useCallback(() => runInitialize(undefined), [runInitialize])

  return {
    status: statusQuery.data,
    isLoading: statusQuery.isLoading,
    isError: statusQuery.isError,
    error: statusQuery.error,
    initialize,
    isInitializing: initializeMutation.isPending,
  }
}
