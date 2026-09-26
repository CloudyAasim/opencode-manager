import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { SettingsList } from '@/components/ui/settings-list'
import { Plus, Loader2, RefreshCw } from 'lucide-react'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { AddMcpServerDialog } from './AddMcpServerDialog'
import { McpServerCard } from './McpServerCard'
import { McpOAuthDialog } from './McpOAuthDialog'
import { useMcpServers } from '@/hooks/useMcpServers'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { invalidateConfigCaches } from '@/lib/queryInvalidation'
import type { McpServerConfig } from '@/api/mcp'
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
    status: mcpStatus, 
    isLoading: isLoadingStatus,
    refetch: refetchStatus,
    connect,
    disconnect,
    removeAuthAsync,
    isRemovingAuth
  } = useMcpServers()

  const deleteServerMutation = useMutation({
    mutationFn: async (serverId: string) => {
      if (!config) return
      
      const currentStatus = mcpStatus?.[serverId]
      if (currentStatus?.status === 'connected') {
        await disconnect(serverId)
      }
      
      const currentMcp = (config.content?.mcp as Record<string, McpServerConfig>) || {}
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

  const mcpServers = config?.content?.mcp as Record<string, McpServerConfig> || {}
  
  const isAnyOperationPending = deleteServerMutation.isPending || togglingServerId !== null

  const handleToggleServer = async (serverId: string) => {
    const currentStatus = mcpStatus?.[serverId]
    if (!currentStatus) return

    const serverConfig = mcpServers[serverId]
    const isRemote = serverConfig?.type === 'remote'
    const hasOAuthConfig = isRemote && !!serverConfig?.oauth
    const hasOAuthError = currentStatus.status === 'failed' && isRemote && /oauth|auth.*state/i.test(currentStatus.error)
    const isOAuthServer = hasOAuthConfig || hasOAuthError || (currentStatus.status === 'needs_auth' && isRemote)
    
    if (currentStatus.status === 'needs_auth' || (currentStatus.status === 'failed' && isOAuthServer)) {
      setAuthDialogServerId(serverId)
      return
    }

    setTogglingServerId(serverId)
    try {
      if (currentStatus.status === 'connected') {
        await disconnect(serverId)
      } else if (currentStatus.status === 'disabled') {
        await connect(serverId)
      } else if (currentStatus.status === 'failed') {
        await connect(serverId)
      }
    } finally {
      setTogglingServerId(null)
      refetchStatus()
    }
  }

  const handleAuthenticate = (serverId: string) => {
    setAuthDialogServerId(serverId)
  }

  const handleOAuthStartAuth = async (): Promise<McpAuthStartResponse> => {
    if (!authDialogServerId) throw new Error(t('settingsPanels.mcpManager.noServerId'))
    const serverConfig = mcpServers[authDialogServerId]
    if (!serverConfig?.url) throw new Error(t('settingsPanels.mcpManager.serverUrlNotFound'))
    const oauthConfig = typeof serverConfig.oauth === 'object' ? serverConfig.oauth : undefined
    return await mcpApi.startAuth(
      authDialogServerId,
      serverConfig.url,
      oauthConfig?.scope,
      oauthConfig?.clientId,
      oauthConfig?.clientSecret,
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
    const status = await mcpApi.getStatus()
    const serverStatus = status[authDialogServerId]
    if (serverStatus?.status === 'connected') {
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
    const status = mcpStatus?.[serverId]
    if (!status) return null
    if (status.status === 'failed') return status.error
    if (status.status === 'needs_client_registration') return status.error
    return null
  }

  if (!config) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">{t('settingsPanels.mcpManager.noConfig')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 relative min-h-[200px]">
      {isAnyOperationPending && (
        <div className="absolute inset-0 -m-4 bg-background/90 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="flex flex-col items-center gap-3 bg-card border border-border rounded-lg p-6 shadow-lg">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-sm font-medium text-foreground">
              {togglingServerId ? t('settingsPanels.mcpManager.updating') : t('settingsPanels.mcpManager.processing')}
            </span>
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
          <RefreshCw className={`h-3 w-3 mr-1 ${isLoadingStatus ? 'animate-spin' : ''}`} />
          {t('settingsPanels.mcpManager.refresh')}
        </Button>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
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
        {Object.entries(mcpServers).map(([serverId, serverConfig]) => {
          const status = mcpStatus?.[serverId]
          const isConnected = status?.status === 'connected'
          const errorMessage = getErrorMessage(serverId)
          
          return (
            <McpServerCard
              key={serverId}
              serverId={serverId}
              serverConfig={serverConfig}
              status={status}
              isConnected={isConnected}
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
