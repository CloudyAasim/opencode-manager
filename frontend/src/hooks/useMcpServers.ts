import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { mcpApi } from '@/api/mcp'
import type { McpServer, McpServerConfig } from '@/api/mcp'
import { showToast as toast } from '@/lib/toast'
import { useI18n } from '@/lib/i18n'
import { messageOf } from '@/lib/messageOf'
import { isSessionListQueryKey } from '@/lib/queryInvalidation'

const SESSION_QUERY_PREDICATE = (query: { queryKey: readonly unknown[] }) =>
  isSessionListQueryKey(query.queryKey) ||
  (query.queryKey[0] === 'opencode' &&
    (query.queryKey[1] === 'session' || query.queryKey[1] === 'messages'))

/**
 * The tool servers, and the changes that may be made to them.
 *
 * The servers come from the layer the client talks to, in the versioned
 * dialect - the client used to ask the agent itself, and for the document the
 * servers are written down in, which is also where the credentials of every
 * model provider on the host live.
 */
export function useMcpServers() {
  const { t } = useI18n()
  const queryClient = useQueryClient()

  const serversQuery = useQuery({
    queryKey: ['mcp', 'servers'],
    queryFn: () => mcpApi.listServers(),
    refetchInterval: 15000,
    staleTime: 10000,
  })

  const addServerMutation = useMutation({
    mutationFn: ({ name, config }: { name: string; config: McpServerConfig }) =>
      mcpApi.addServer(name, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp', 'servers'] })
      queryClient.invalidateQueries({ predicate: SESSION_QUERY_PREDICATE })
      toast.success(t('settingsPanels.mcpManager.toast.added'))
    },
    onError: (error: Error) => {
      toast.error(t('settingsPanels.mcpManager.toast.addFailed', { error: messageOf(error) }))
    },
  })

  const connectMutation = useMutation({
    mutationFn: (name: string) => mcpApi.connect(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp', 'servers'] })
      queryClient.invalidateQueries({ predicate: SESSION_QUERY_PREDICATE })
      toast.success(t('settingsPanels.mcpManager.toast.connected'))
    },
    onError: (error: Error) => {
      toast.error(t('settingsPanels.mcpManager.toast.connectFailed', { error: messageOf(error) }))
    },
  })

  const disconnectMutation = useMutation({
    mutationFn: (name: string) => mcpApi.disconnect(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp', 'servers'] })
      queryClient.invalidateQueries({ predicate: SESSION_QUERY_PREDICATE })
      toast.success(t('settingsPanels.mcpManager.toast.disconnected'))
    },
    onError: (error: Error) => {
      toast.error(t('settingsPanels.mcpManager.toast.disconnectFailed', { error: messageOf(error) }))
    },
  })

  const startAuthMutation = useMutation({
    mutationFn: ({ name, serverUrl, scope, clientId, directory }: { name: string; serverUrl: string; scope?: string; clientId?: string; directory?: string }) =>
      mcpApi.startAuth(name, serverUrl, scope, clientId, directory),
    onError: (error: Error) => {
      toast.error(t('settingsPanels.mcpManager.toast.authStartFailed', { error: messageOf(error) }))
    },
  })

  const completeAuthMutation = useMutation({
    mutationFn: ({ name, code }: { name: string; code: string }) =>
      mcpApi.completeAuth(name, code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp', 'servers'] })
      toast.success(t('settingsPanels.mcpManager.toast.authCompleted'))
    },
    onError: (error: Error) => {
      toast.error(t('settingsPanels.mcpManager.toast.authCompleteFailed', { error: messageOf(error) }))
    },
  })

  const removeAuthMutation = useMutation({
    mutationFn: (name: string) => mcpApi.removeAuth(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp', 'servers'] })
      queryClient.invalidateQueries({ predicate: SESSION_QUERY_PREDICATE })
      toast.success(t('settingsPanels.mcpManager.toast.authRemoved'))
    },
    onError: (error: Error) => {
      toast.error(t('settingsPanels.mcpManager.toast.authRemoveFailed', { error: messageOf(error) }))
    },
  })

  return {
    servers: serversQuery.data as McpServer[] | undefined,
    isLoading: serversQuery.isLoading,
    isError: serversQuery.isError,
    error: serversQuery.error,
    refetch: serversQuery.refetch,

    addServer: addServerMutation.mutate,
    addServerAsync: addServerMutation.mutateAsync,
    isAddingServer: addServerMutation.isPending,

    connect: connectMutation.mutate,
    connectAsync: connectMutation.mutateAsync,
    isConnecting: connectMutation.isPending,

    disconnect: disconnectMutation.mutate,
    disconnectAsync: disconnectMutation.mutateAsync,
    isDisconnecting: disconnectMutation.isPending,

    startAuth: startAuthMutation.mutate,
    startAuthAsync: startAuthMutation.mutateAsync,
    isStartingAuth: startAuthMutation.isPending,

    completeAuth: completeAuthMutation.mutate,
    completeAuthAsync: completeAuthMutation.mutateAsync,
    isCompletingAuth: completeAuthMutation.isPending,

    removeAuth: removeAuthMutation.mutate,
    removeAuthAsync: removeAuthMutation.mutateAsync,
    isRemovingAuth: removeAuthMutation.isPending,
  }
}
