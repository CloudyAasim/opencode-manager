import { Switch } from '@/components/ui/switch'
import { PanelLoading } from '@/components/ui/panel-loading'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { XCircle, AlertCircle, Plug, Shield, Key, RefreshCw, ChevronDown } from 'lucide-react'
import type { McpStatus, McpServerConfig } from '@/api/mcp'
import { useI18n } from '@/lib/i18n'


interface RepoMcpServerListProps {
  hasFetchedStatus: boolean
  serverIds: string[]
  isLoadingStatus: boolean
  localStatus: Record<string, McpStatus>
  mcpServers: Record<string, McpServerConfig>
  toggleMutation: {
    mutate: (variables: { serverId: string; enable: boolean }) => void
    isPending: boolean
  }
  removeAuthMutation: {
    mutate: (variables: string) => void
    isPending: boolean
  }
  onAuthClick: (serverId: string) => void
  onRemoveAuthClick: (serverId: string) => void
}

export function RepoMcpServerList({
  hasFetchedStatus,
  serverIds,
  isLoadingStatus,
  localStatus,
  mcpServers,
  toggleMutation,
  removeAuthMutation,
  onAuthClick,
  onRemoveAuthClick,
}: RepoMcpServerListProps) {
  const { t } = useI18n()
  const getDisplayName = (serverId: string): string => {
    const name = serverId.replace(/[-_]/g, ' ')
    return name.charAt(0).toUpperCase() + name.slice(1)
  }

  const getDescription = (serverConfig: McpServerConfig): string => {
    if (serverConfig.type === 'local' && serverConfig.command) {
      const command = serverConfig.command.join(' ')
      if (command.includes('filesystem')) return t('repo.mcp.fileSystemAccess')
      if (command.includes('git')) return t('repo.mcp.gitRepositoryOperations')
      if (command.includes('sqlite')) return t('repo.mcp.sqliteAccess')
      if (command.includes('postgres')) return t('repo.mcp.postgresAccess')
      if (command.includes('brave-search')) return t('repo.mcp.webSearchBrave')
      if (command.includes('github')) return t('repo.mcp.githubAccess')
      if (command.includes('slack')) return t('repo.mcp.slackIntegration')
      if (command.includes('puppeteer')) return t('repo.mcp.webAutomation')
      if (command.includes('fetch')) return t('repo.mcp.httpRequests')
      if (command.includes('memory')) return t('repo.mcp.persistentMemory')
      return t('repo.mcp.localCommand', { command })
    } else if (serverConfig.type === 'remote' && serverConfig.url) {
      return serverConfig.url
    }
    return t('repo.mcp.server')
  }

  const getStatusBadge = (status?: McpStatus) => {
    if (!status) return null

    switch (status.status) {
      case 'connected':
        return <Badge variant="default" className="text-xs bg-green-600">{t('repo.mcp.connected')}</Badge>
      case 'disabled':
        return <Badge className="text-xs bg-gray-700 text-gray-300 border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600">{t('repo.mcp.disabled')}</Badge>
      case 'failed':
        return (
          <Badge variant="destructive" className="text-xs flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {t('repo.mcp.failed')}
          </Badge>
        )
      case 'needs_auth':
        return (
          <Badge variant="outline" className="text-xs border-yellow-500 text-yellow-600">
            {t('repo.mcp.needsAuth')}
          </Badge>
        )
      default:
        return <Badge variant="outline" className="text-xs">{t('repo.mcp.unknown')}</Badge>
    }
  }

  return (
    <div className="px-4 sm:px-6 py-3 sm:py-4 flex-1 overflow-y-auto min-h-0">
      {hasFetchedStatus && serverIds.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground">
          <Plug className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="text-sm">{t('repo.mcp.noServers')}</p>
          <p className="text-xs mt-1">{t('repo.mcp.noServersHint')}</p>
        </div>
      ) : isLoadingStatus ? (
        <PanelLoading className="py-8" size="sm" label={t('repo.loading')} />
      ) : (
        <div className="space-y-3">
          {serverIds.map((serverId) => {
            const serverConfig = mcpServers[serverId]
            const status = localStatus[serverId]
            const isConnected = status?.status === 'connected'
            const needsAuth = status?.status === 'needs_auth'
            const failed = status?.status === 'failed'
            const isRemote = serverConfig?.type === 'remote'
            const hasOAuthConfig = isRemote && !!serverConfig?.oauth
            const hasOAuthError = failed && isRemote && !!status?.error && /oauth|auth.*state/i.test(status.error)
            const isOAuthServer = hasOAuthConfig || hasOAuthError || (needsAuth && isRemote)
            const connectedWithOAuth = isOAuthServer && isConnected
            const showAuthButton = needsAuth || (isOAuthServer && failed)

            return (
              <div
                key={serverId}
                className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-card"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-medium truncate">
                      {getDisplayName(serverId)}
                    </p>
                    {(showAuthButton || connectedWithOAuth) ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button 
                            className="cursor-pointer hover:bg-accent rounded inline-flex items-center gap-1"
                            title={t('repo.mcp.optionsTitle')}
                          >
                            {status?.status === 'connected' && (
                              <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                                {t('repo.mcp.connected')}<ChevronDown className="h-3 w-3" />
                              </span>
                            )}
                            {status?.status === 'needs_auth' && (
                              <span className="text-xs border border-yellow-500 text-yellow-600 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                                {t('repo.mcp.needsAuth')}<ChevronDown className="h-3 w-3" />
                              </span>
                            )}
                            {status?.status === 'failed' && (
                              <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                                <AlertCircle className="h-3 w-3" />{t('repo.mcp.failed')}<ChevronDown className="h-3 w-3" />
                              </span>
                            )}
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          {showAuthButton && (
                            <DropdownMenuItem onClick={() => onAuthClick(serverId)}>
                              <Key className="h-4 w-4 mr-2" />
                              {t('repo.mcp.authenticate')}
                            </DropdownMenuItem>
                          )}
                          {connectedWithOAuth && (
                            <DropdownMenuItem onClick={() => onAuthClick(serverId)}>
                              <RefreshCw className="h-4 w-4 mr-2" />
                              {t('repo.mcp.reauthenticate')}
                            </DropdownMenuItem>
                          )}
                          {connectedWithOAuth && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => onRemoveAuthClick(serverId)}
                                disabled={removeAuthMutation.isPending}
                              >
                                <Shield className="h-4 w-4 mr-2" />
                                {removeAuthMutation.isPending ? t('repo.mcp.removing') : t('repo.mcp.removeAuth')}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      getStatusBadge(status)
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {serverConfig ? getDescription(serverConfig) : t('repo.mcp.server')}
                  </p>
                  {failed && status.status === 'failed' && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-red-500">
                      <XCircle className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{status.error}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {showAuthButton ? (
                    <Button
                      onClick={() => onAuthClick(serverId)}
                      disabled={toggleMutation.isPending}
                      variant="default"
                      size="sm"
                    >
                      <Key className="h-3 w-3 mr-1" />
                      {t('repo.mcp.auth')}
                    </Button>
                  ) : (
                    <Switch
                      checked={isConnected}
                      disabled={toggleMutation.isPending || removeAuthMutation.isPending}
                      onCheckedChange={(enabled) => {
                        toggleMutation.mutate({ serverId, enable: enabled })
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
