import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { SettingsList } from '@/components/ui/settings-list'
import { Plus, RefreshCw, Plug } from 'lucide-react'
import { PanelMessage } from '@/components/ui/panel-message'
import { PanelLoading } from '@/components/ui/panel-loading'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { AddMcpServerDialog } from './AddMcpServerDialog'
import { McpServerCard } from './McpServerCard'
import { McpOAuthDialog } from './McpOAuthDialog'
import { useMcpServers } from '@/hooks/useMcpServers'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { invalidateConfigCaches } from '@/lib/queryInvalidation'
import type { McpServer } from '@/api/mcp'
import { mcpApi } from '@/api/mcp'
import type { McpAuthStartResponse } from '@/api/mcp'
import { showToast } from '@/lib/toast'
import { useI18n } from '@/lib/i18n'

interface McpManagerProps {
  config: {
    content: Record<string, unknown>
  } | null
  onUpdate: (content: Record<string, unknown>) => Promise<void>
}



export function McpManager({ config, onUpdate }: McpManagerProps) {
  const { t } = useI18n()
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [deleteConfirmServer, setDeleteConfirmServer] = useState<{ id: string; name: string } | null>(null)
  const [togglingServerId, setTogglingServerId] = useState<string | null>(null)
  const [authDialogServerId, setAuthDialogServerId] = useState<string | null>(null)
  const [removeAuthConfirmServer, setRemoveAuthConfirmServer] = useState<string | null>(null)

  const queryClient = useQueryClient()
  const {
    servers,
    isLoading: isLoadingStatus,
    refetch: refetchStatus,
    connectAsync,
    disconnectAsync,
    removeAuthAsync,
    isRemovingAuth
  } = useMcpServers()

  /**
   * What the agent says about one server.
   *
   * The list is the agent's, and the configuration document is the person's:
   * a server that is written down but was not spoken of is one the agent has
   * not picked up yet, and it is drawn as unknown rather than as absent.
   */
  const serverOf = (serverId: string): McpServer | undefined =>
    servers?.find((server) => server.name === serverId)

  const deleteServerMutation = useMutation({
    mutationFn: async (serverId: string) => {
      if (!config) return

      const currentServer = serverOf(serverId)
      if (currentServer?.state === 'connected') {
        await disconnectAsync(serverId)
      }

      const currentMcp = (config.content?.mcp as Record<string, unknown>) || {}
      const { [serverId]: _, ...rest } = currentMcp
      void _

      const updatedConfig = {
        ...config.content,
        mcp: rest,
      }

      await onUpdate(updatedConfig)
    },
    onSuccess: async () => {
      invalidateConfigCaches(queryClient)
      await refetchStatus()
      setDeleteConfirmServer(null)
    },
    onError: () => {
      showToast.error(t('settingsPanels.mcpManager.deleteFailed'))
    },
  })

  const mcpServers = config?.content?.mcp as Record<string, unknown> || {}

  const isAnyOperationPending = deleteServerMutation.isPending || togglingServerId !== null

  const handleToggleServer = async (serverId: string) => {
    const currentServer = serverOf(serverId)
    if (!currentServer) return

    const isRemote = currentServer.kind === 'remote'
    const hasOAuthConfig = isRemote && !!currentServer.oauth
    const hasOAuthError =
      currentServer.state === 'failed' &&
      isRemote &&
      /oauth|auth.*state/i.test(currentServer.detail ?? '')
    const isOAuthServer = hasOAuthConfig || hasOAuthError || (currentServer.state === 'needs_auth' && isRemote)

    if (currentServer.state === 'needs_auth' || (currentServer.state === 'failed' && isOAuthServer)) {
      setAuthDialogServerId(serverId)
      return
    }

    setTogglingServerId(serverId)
    try {
      if (currentServer.state === 'connected') {
        await disconnectAsync(serverId)
      } else {
        await connectAsync(serverId)
      }
    } catch {
      // connectAsync / disconnectAsync reject here; the hook toasts the reason
    } finally {
      // their own onSuccess already invalidates ['mcp', 'servers'], so no refetch here
      setTogglingServerId(null)
    }
  }

  const handleAuthenticate = (serverId: string) => {
    setAuthDialogServerId(serverId)
  }

  const handleOAuthStartAuth = async (): Promise<McpAuthStartResponse> => {
    if (!authDialogServerId) throw new Error(t('settingsPanels.mcpManager.noServerId'))
    const server = serverOf(authDialogServerId)
    if (!server?.url) throw new Error(t('settingsPanels.mcpManager.serverUrlNotFound'))
    return await mcpApi.startAuth(
      authDialogServerId,
      server.url,
      server.oauth?.scope ?? undefined,
      server.oauth?.clientId ?? undefined,
    )
  }

  const handleOAuthCompleteAuth = async (code: string) => {
    if (!authDialogServerId) return
    await mcpApi.completeAuth(authDialogServerId, code)
    refetchStatus()
    setAuthDialogServerId(null)
  }

  const handleOAuthCheckStatus = async (): Promise<boolean> => {
    if (!authDialogServerId) return false
    const server = serverOf(authDialogServerId)
    if (server?.state === 'connected') {
      refetchStatus()
      return true
    }
    return false
  }

  const handleOAuthSuccess = () => {
    refetchStatus()
  }

  const handleRemoveAuth = (serverId: string) => {
    setRemoveAuthConfirmServer(serverId)
  }

  const handleConfirmRemoveAuth = async () => {
    if (removeAuthConfirmServer) {
      await removeAuthAsync(removeAuthConfirmServer)
      setRemoveAuthConfirmServer(null)
      refetchStatus()
    }
  }

  const handleDeleteServer = () => {
    if (deleteConfirmServer) {
      deleteServerMutation.mutate(deleteConfirmServer.id)
    }
  }



  const getErrorMessage = (serverId: string): string | null => {
    const server = serverOf(serverId)
    if (!server) return null
    if (server.state === 'failed') return server.detail
    if (server.state === 'needs_client_registration') return server.detail
    return null
  }

  if (!config) {
    return (
      <PanelMessage
  icon={<Plug />}
  title={t('settingsPanels.mcpManager.noConfig')}
  detail={t('settingsPanels.mcpManager.noConfigHint')}
  className="py-8"
/>
    )
  }

  return (
    <div className="space-y-6 relative min-h-[200px]">
      {isAnyOperationPending && (
        <div className="absolute inset-0 -m-4 bg-background/90 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="flex flex-col items-center gap-3 bg-card border border-border rounded-lg p-6 shadow-lg">
            <PanelLoading
              size="lg"
              className="py-0"
              label={
                togglingServerId
                  ? t('settingsPanels.mcpManager.updating')
                  : t('settingsPanels.mcpManager.processing')
              }
            />
            <span className="text-xs text-muted-foreground">
              {t('settingsPanels.mcpManager.pleaseWait')}
            </span>
          </div>
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetchStatus()}
          disabled={isLoadingStatus}
        >
          <RefreshCw className={`size-3 mr-1 ${isLoadingStatus ? 'animate-spin' : ''}`} />
          {t('settingsPanels.mcpManager.refresh')}
        </Button>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4 mr-1" />
              {t('settingsPanels.mcpManager.addServer')}
            </Button>
          </DialogTrigger>
          <AddMcpServerDialog 
            open={isAddDialogOpen} 
            onOpenChange={setIsAddDialogOpen}
            onUpdate={onUpdate}
          />
        </Dialog>
      </div>

      <SettingsList
        isLoading={false}
        error={null}
        isEmpty={Object.keys(mcpServers).length === 0}
        emptyTitle={t('settingsPanels.mcpManager.emptyTitle')}
        emptyHint={t('settingsPanels.mcpManager.emptyHint')}
      >
        {Object.entries(mcpServers).map(([serverId]) => {
          const server = serverOf(serverId)
          const errorMessage = getErrorMessage(serverId)

          return (
            <McpServerCard
              key={serverId}
              serverId={serverId}
              server={server}
              errorMessage={errorMessage}
              isAnyOperationPending={isAnyOperationPending}
              togglingServerId={togglingServerId}
              isRemovingAuth={isRemovingAuth}
              onToggleServer={handleToggleServer}
              onAuthenticate={handleAuthenticate}
              onRemoveAuth={handleRemoveAuth}
              onDeleteServer={(id, name) => setDeleteConfirmServer({ id, name })}
            />
          )
        })}
      </SettingsList>

      <DeleteDialog
        open={!!deleteConfirmServer}
        onOpenChange={() => setDeleteConfirmServer(null)}
        onConfirm={handleDeleteServer}
        onCancel={() => setDeleteConfirmServer(null)}
        title={t('settingsPanels.mcpManager.deleteTitle')}
        description={t('settingsPanels.mcpManager.deleteDescription')}
        itemName={deleteConfirmServer?.name}
        isDeleting={deleteServerMutation.isPending}
      />

      <McpOAuthDialog
        open={!!authDialogServerId}
        onOpenChange={(open) => !open && setAuthDialogServerId(null)}
        serverName={authDialogServerId || ''}
        onStartAuth={handleOAuthStartAuth}
        onCompleteAuth={handleOAuthCompleteAuth}
        onCheckStatus={handleOAuthCheckStatus}
        onSuccess={handleOAuthSuccess}
      />

      <DeleteDialog
        open={!!removeAuthConfirmServer}
        onOpenChange={() => setRemoveAuthConfirmServer(null)}
        onConfirm={handleConfirmRemoveAuth}
        onCancel={() => setRemoveAuthConfirmServer(null)}
        title={t('settingsPanels.mcpManager.removeAuthTitle')}
        description={t('settingsPanels.mcpManager.removeAuthDescription')}
        itemName={mcpServers[removeAuthConfirmServer || ''] ? getDisplayName(removeAuthConfirmServer || '') : ''}
        isDeleting={isRemovingAuth}
      />
    </div>
  )

  function getDisplayName(serverId: string): string {
    const name = serverId.replace(/[-_]/g, ' ')
    return name.charAt(0).toUpperCase() + name.slice(1)
  }
}
