import { useState, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { RepoMcpServerList } from './RepoMcpServerList'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { McpOAuthDialog } from '@/features/settings/McpOAuthDialog'
import { mcpApi, type McpServer, type McpAuthStartResponse } from '@/api/mcp'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { invalidateSessionCaches } from '@/lib/queryInvalidation'
import { showToast } from '@/lib/toast'
import { useI18n } from '@/lib/i18n'

interface RepoMcpDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  directory: string | undefined
}

/**
 * The tool servers of one working directory.
 *
 * The servers come from the layer the client talks to: the client used to
 * ask the agent for the state of them and for the document they are written
 * down in, and that document also holds the credentials of every model
 * provider on the host.
 */
export function RepoMcpDialog({ open, onOpenChange, directory }: RepoMcpDialogProps) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [servers, setServers] = useState<McpServer[]>([])
  const [isLoadingStatus, setIsLoadingStatus] = useState(false)
  const [statusError, setStatusError] = useState<Error | null>(null)
  const [hasFetchedStatus, setHasFetchedStatus] = useState(false)
  const [removeAuthConfirmServer, setRemoveAuthConfirmServer] = useState<string | null>(null)
  const [authDialogServerId, setAuthDialogServerId] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    if (!directory) return

    setIsLoadingStatus(true)
    setStatusError(null)
    try {
      const answer = await mcpApi.listServers(directory)
      setServers(answer)
      setHasFetchedStatus(true)
    } catch (error) {
      setStatusError(error instanceof Error ? error : new Error(String(error)))
    } finally {
      setIsLoadingStatus(false)
    }
  }, [directory])

  const toggleMutation = useMutation({
    mutationFn: async ({ serverId, enable }: { serverId: string; enable: boolean }) => {
      if (!directory) throw new Error(t('repo.mcp.noDirectory'))

      const currentServer = servers.find((server) => server.name === serverId)

      if (enable) {
        if (currentServer?.state === 'needs_auth') {
          await mcpApi.authenticate(serverId, directory)
        } else {
          await mcpApi.connect(serverId, directory)
        }
      } else {
        await mcpApi.disconnect(serverId, directory)
      }
    },
    onSuccess: async () => {
      showToast.success(t('repo.mcp.updated'))
      await fetchStatus()
      invalidateSessionCaches(queryClient)
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : t('repo.mcp.updateFailed'))
    },
  })

  const removeAuthMutation = useMutation({
    mutationFn: async (serverId: string) => {
      if (!directory) throw new Error(t('repo.mcp.noDirectory'))
      await mcpApi.removeAuth(serverId, directory)
    },
    onSuccess: async () => {
      showToast.success(t('repo.mcp.authRemoved'))
      setRemoveAuthConfirmServer(null)
      await fetchStatus()
      invalidateSessionCaches(queryClient)
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : t('repo.mcp.removeAuthFailed'))
    },
  })

  const handleOAuthStartAuth = async (): Promise<McpAuthStartResponse> => {
    if (!authDialogServerId) throw new Error(t('repo.mcp.noServerId'))
    const server = servers.find((entry) => entry.name === authDialogServerId)
    if (!server?.url) throw new Error(t('repo.mcp.serverUrlNotFound'))
    return await mcpApi.startAuth(
      authDialogServerId,
      server.url,
      server.oauth?.scope ?? undefined,
      server.oauth?.clientId ?? undefined,
      directory,
    )
  }

  const handleOAuthCompleteAuth = async (code: string) => {
    if (!authDialogServerId) return
    await mcpApi.completeAuth(authDialogServerId, code, directory)
    await fetchStatus()
    invalidateSessionCaches(queryClient)
    setAuthDialogServerId(null)
  }

  const handleOAuthCheckStatus = async (): Promise<boolean> => {
    if (!authDialogServerId || !directory) return false
    const answer = await mcpApi.listServers(directory)
    const server = answer.find((entry) => entry.name === authDialogServerId)
    if (server?.state === 'connected') {
      setServers(answer)
      return true
    }
    return false
  }

  const handleOAuthSuccess = () => {
    fetchStatus()
    invalidateSessionCaches(queryClient)
  }

  useEffect(() => {
    if (open && directory) {
      fetchStatus()
    }
  }, [open, directory, fetchStatus])

  const getDisplayName = (serverId: string): string => {
    const name = serverId.replace(/[-_]/g, ' ')
    return name.charAt(0).toUpperCase() + name.slice(1)
  }

  if (!directory) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent height="short" width="md" mobileFullscreen className="sm:fixed sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:h-auto flex flex-col gap-0 sm:gap-4 pb-safe sm:pb-6">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('repo.mcp.title')}</DialogTitle>
          <DialogDescription>
            {t('repo.mcp.description')}
          </DialogDescription>
        </DialogHeader>

        <RepoMcpServerList
          hasFetchedStatus={hasFetchedStatus}
          statusError={statusError}
          onRetry={() => { void fetchStatus() }}
          servers={servers}
          isLoadingStatus={isLoadingStatus}
          toggleMutation={toggleMutation}
          removeAuthMutation={removeAuthMutation}
          onAuthClick={setAuthDialogServerId}
          onRemoveAuthClick={setRemoveAuthConfirmServer}
        />

        <DeleteDialog
          open={!!removeAuthConfirmServer}
          onOpenChange={() => setRemoveAuthConfirmServer(null)}
          onConfirm={() => {
            if (removeAuthConfirmServer) {
              removeAuthMutation.mutate(removeAuthConfirmServer)
            }
          }}
          onCancel={() => setRemoveAuthConfirmServer(null)}
          title={t('repo.mcp.removeAuthTitle')}
          description={t('repo.mcp.removeAuthDescription')}
          itemName={removeAuthConfirmServer ? getDisplayName(removeAuthConfirmServer) : ''}
          isDeleting={removeAuthMutation.isPending}
        />

        <McpOAuthDialog
          open={!!authDialogServerId}
          onOpenChange={(o) => !o && setAuthDialogServerId(null)}
          serverName={authDialogServerId || ''}
          onStartAuth={handleOAuthStartAuth}
          onCompleteAuth={handleOAuthCompleteAuth}
          onCheckStatus={handleOAuthCheckStatus}
          onSuccess={handleOAuthSuccess}
          directory={directory}
        />
      </DialogContent>
    </Dialog>
  )
}
