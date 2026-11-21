import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { mcpApi } from '@/api/mcp'
import type { McpServer, McpServerConfig } from '@/api/mcp'
import { showToast as toast } from '@/lib/toast'
import { useI18n } from '@/lib/i18n'
import { messageOf } from '@/lib/messageOf'
import { isSessionListQueryKey, messagesQuerySession, MCP_SERVERS_KEY, sessionQuerySession } from '@/lib/queryInvalidation'

/**
 * The conversations, as they are cached.
 *
 * The tool servers change what an agent may do, so the conversations have to
 * be asked for again when they change.
 *
 * This used to look for the conversations under the agent's own name, which
 * is where they went to be asked for before they moved to the layer - so it
 * matched nothing, and adding a tool server left every conversation showing
 * what it was allowed to do before.
 */
const SESSION_QUERY_PREDICATE = (query: { queryKey: readonly unknown[] }) =>
  isSessionListQueryKey(query.queryKey) ||
  sessionQuerySession(query.queryKey) !== null ||
  messagesQuerySession(query.queryKey) !== null

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
    queryKey: MCP_SERVERS_KEY,
    queryFn: () => mcpApi.listServers(),
    refetchInterval: 15000,
    staleTime: 10000,
  })

  const addServerMutation = useMutation({
    mutationFn: ({ name, config }: { name: string; config: McpServerConfig }) =>
      mcpApi.addServer(name, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MCP_SERVERS_KEY })
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
      queryClient.invalidateQueries({ queryKey: MCP_SERVERS_KEY })
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
      queryClient.invalidateQueries({ queryKey: MCP_SERVERS_KEY })
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
      queryClient.invalidateQueries({ queryKey: MCP_SERVERS_KEY })
      toast.success(t('settingsPanels.mcpManager.toast.authCompleted'))
    },
    onError: (error: Error) => {
      toast.error(t('settingsPanels.mcpManager.toast.authCompleteFailed', { error: messageOf(error) }))
    },
  })

  const removeAuthMutation = useMutation({
    mutationFn: (name: string) => mcpApi.removeAuth(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MCP_SERVERS_KEY })
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
