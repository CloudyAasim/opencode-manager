import { Switch } from '@/components/ui/switch'
import { PanelLoading } from '@/components/ui/panel-loading'
import { PanelMessage } from '@/components/ui/panel-message'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { XCircle, AlertCircle, Plug, Shield, Key, RefreshCw, ChevronDown } from 'lucide-react'
import type { McpServer } from '@/api/mcp'
import { useI18n } from '@/lib/i18n'


interface RepoMcpServerListProps {
  hasFetchedStatus: boolean
  statusError: Error | null
  onRetry: () => void
  servers: McpServer[]
  isLoadingStatus: boolean
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
  statusError,
  onRetry,
  servers,
  isLoadingStatus,
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

  const getDescription = (server: McpServer): string => {
    if (server.kind === 'local' && server.command) {
      const command = server.command.join(' ')
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
    } else if (server.kind === 'remote' && server.url) {
      return server.url
    }
    return t('repo.mcp.server')
  }

  const getStatusBadge = (server: McpServer) => {
    switch (server.state) {
      case 'connected':
        return <Badge variant="success">{t('repo.mcp.connected')}</Badge>
      case 'disabled':
        return <Badge variant="secondary">{t('repo.mcp.disabled')}</Badge>
      case 'failed':
        return (
          <Badge variant="destructive" className="flex items-center gap-1">
            <AlertCircle className="size-3" />
            {t('repo.mcp.failed')}
          </Badge>
        )
      case 'needs_auth':
        return (
          <Badge variant="outline-warning">
            {t('repo.mcp.needsAuth')}
          </Badge>
        )
      default:
        return <Badge variant="outline">{t('repo.mcp.unknown')}</Badge>
    }
  }

  return (
    <div className="px-4 sm:px-6 py-3 sm:py-4 flex-1 overflow-y-auto min-h-0">
      {statusError ? (
        <PanelMessage
          icon={<AlertCircle className="text-destructive" />}
          title={t('repo.mcp.statusLoadFailed')}
          detail={statusError.message}
          action={
            <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
              <RefreshCw className="size-3 mr-1" />
              {t('common.retry')}
            </Button>
          }
        />
      ) : hasFetchedStatus && servers.length === 0 ? (
        <PanelMessage
          icon={<Plug />}
          title={t('repo.mcp.noServers')}
          detail={t('repo.mcp.noServersHint')}
          className="py-6"
        />
      ) : isLoadingStatus ? (
        <PanelLoading className="py-8" size="sm" label={t('repo.loading')} />
      ) : (
        <div className="space-y-3">
          {servers.map((server) => {
            const serverId = server.name
            const isConnected = server.state === 'connected'
            const needsAuth = server.state === 'needs_auth'
            const failed = server.state === 'failed'
            const isRemote = server.kind === 'remote'
            const hasOAuthConfig = isRemote && !!server.oauth
            const hasOAuthError = failed && isRemote && !!server.detail && /oauth|auth.*state/i.test(server.detail)
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
                          <Button
                            variant="ghost"
                            size="2xs"
                            title={t('repo.mcp.optionsTitle')}
                          >
                            {server.state === 'connected' && (
                              <span className="text-xs bg-success text-white px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                                {t('repo.mcp.connected')}<ChevronDown className="size-3" />
                              </span>
                            )}
                            {server.state === 'needs_auth' && (
                              <span className="text-xs border border-warning text-warning px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                                {t('repo.mcp.needsAuth')}<ChevronDown className="size-3" />
                              </span>
                            )}
                            {server.state === 'failed' && (
                              <span className="text-xs bg-destructive text-white px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                                <AlertCircle className="size-3" />{t('repo.mcp.failed')}<ChevronDown className="size-3" />
                              </span>
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          {showAuthButton && (
                            <DropdownMenuItem onClick={() => onAuthClick(serverId)}>
                              <Key className="size-4 mr-2" />
                              {t('repo.mcp.authenticate')}
                            </DropdownMenuItem>
                          )}
                          {connectedWithOAuth && (
                            <DropdownMenuItem onClick={() => onAuthClick(serverId)}>
                              <RefreshCw className="size-4 mr-2" />
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
                                <Shield className="size-4 mr-2" />
                                {removeAuthMutation.isPending ? t('repo.mcp.removing') : t('repo.mcp.removeAuth')}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      getStatusBadge(server)
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {getDescription(server)}
                  </p>
                  {failed && server.detail && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-destructive">
                      <XCircle className="size-3 flex-shrink-0" />
                      <span className="truncate">{server.detail}</span>
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
                      <Key className="size-3 mr-1" />
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
