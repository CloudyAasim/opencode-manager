import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { SettingsListRow, type SettingsListRowAction } from '@/components/ui/settings-list'
import { XCircle, AlertCircle, Key, Shield, Trash2, RefreshCw } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import type { McpStatus, McpServerConfig } from '@/api/mcp'

type Translate = ReturnType<typeof useI18n>['t']

interface McpServerCardProps {
  serverId: string
  serverConfig: McpServerConfig
  status?: McpStatus
  isConnected: boolean
  errorMessage: string | null
  isAnyOperationPending: boolean
  togglingServerId: string | null
  isRemovingAuth: boolean
  onToggleServer: (serverId: string) => void
  onAuthenticate?: (serverId: string) => void
  onRemoveAuth?: (serverId: string) => void
  onDeleteServer: (serverId: string, serverName: string) => void
}

function getStatusBadge(status: McpStatus, t: Translate) {
  switch (status.status) {
    case 'connected':
      return <Badge variant="default" className="text-xs bg-green-600">{t('settingsPanels.mcpServerCard.connected')}</Badge>
    case 'disabled':
      return <Badge variant="secondary" className="text-xs">{t('settingsPanels.mcpServerCard.disabled')}</Badge>
    case 'failed':
      return (
        <Badge variant="destructive" className="text-xs flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {t('settingsPanels.mcpServerCard.failed')}
        </Badge>
      )
    case 'needs_auth':
      return (
        <Badge variant="outline" className="text-xs flex items-center gap-1 border-yellow-500 text-yellow-600">
          <Key className="h-3 w-3" />
          {t('settingsPanels.mcpServerCard.authRequired')}
        </Badge>
      )
    case 'needs_client_registration':
      return (
        <Badge variant="outline" className="text-xs flex items-center gap-1 border-orange-500 text-primary">
          <AlertCircle className="h-3 w-3" />
          {t('settingsPanels.mcpServerCard.registrationRequired')}
        </Badge>
      )
    default:
      return <Badge variant="outline" className="text-xs">{t('settingsPanels.mcpServerCard.unknown')}</Badge>
  }
}

function getServerDisplayName(serverId: string): string {
  const name = serverId.replace(/[-_]/g, ' ')
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function getServerDescription(serverConfig: McpServerConfig, t: Translate): string {
  if (serverConfig.type === 'local' && serverConfig.command) {
    const command = serverConfig.command.join(' ')
    if (command.includes('filesystem')) return t('settingsPanels.mcpServerCard.fsAccess')
    if (command.includes('git')) return t('settingsPanels.mcpServerCard.gitOps')
    if (command.includes('sqlite')) return t('settingsPanels.mcpServerCard.sqliteAccess')
    if (command.includes('postgres')) return t('settingsPanels.mcpServerCard.postgresAccess')
    if (command.includes('brave-search')) return t('settingsPanels.mcpServerCard.webSearchBrave')
    if (command.includes('github')) return t('settingsPanels.mcpServerCard.githubAccess')
    if (command.includes('slack')) return t('settingsPanels.mcpServerCard.slackIntegration')
    if (command.includes('puppeteer')) return t('settingsPanels.mcpServerCard.webAutomation')
    if (command.includes('fetch')) return t('settingsPanels.mcpServerCard.httpRequests')
    if (command.includes('memory')) return t('settingsPanels.mcpServerCard.persistentMemory')
    return t('settingsPanels.mcpServerCard.localCommand', { command })
  } else if (serverConfig.type === 'remote' && serverConfig.url) {
    return t('settingsPanels.mcpServerCard.remoteServer', { url: serverConfig.url })
  }
  return t('settingsPanels.mcpServerCard.mcpServer')
}

export function McpServerCard({
  serverId,
  serverConfig,
  status,
  isConnected,
  errorMessage,
  isAnyOperationPending,
  togglingServerId,
  isRemovingAuth,
  onToggleServer,
  onAuthenticate,
  onRemoveAuth,
  onDeleteServer
}: McpServerCardProps) {
  const { t } = useI18n()
  const needsAuth = status?.status === 'needs_auth'
  const isRemote = serverConfig.type === 'remote'
  const hasOAuthConfig = isRemote && !!serverConfig.oauth
  const hasOAuthError = status?.status === 'failed' && isRemote && /oauth|auth.*state/i.test(status.error)
  const isOAuthServer = hasOAuthConfig || hasOAuthError || (needsAuth && isRemote)
  const connectedWithOAuth = isOAuthServer && isConnected
  const showAuthButton = needsAuth || (isOAuthServer && status?.status === 'failed')
  const displayName = getServerDisplayName(serverId)

  const actions: SettingsListRowAction[] = []
  if (showAuthButton && onAuthenticate) {
    actions.push({ label: t('settingsPanels.mcpServerCard.authenticate'), onClick: () => onAuthenticate(serverId), icon: <Key className="h-4 w-4 mr-2" /> })
  }
  if (connectedWithOAuth && onAuthenticate) {
    actions.push({ label: t('settingsPanels.mcpServerCard.reauthenticate'), onClick: () => onAuthenticate(serverId), icon: <RefreshCw className="h-4 w-4 mr-2" /> })
  }
  if (connectedWithOAuth && onRemoveAuth) {
    actions.push({ label: isRemovingAuth ? t('settingsPanels.mcpServerCard.removing') : t('settingsPanels.mcpServerCard.removeAuth'), onClick: () => onRemoveAuth(serverId), icon: <Shield className="h-4 w-4 mr-2" />, disabled: isRemovingAuth })
  }
  actions.push({ label: t('settingsPanels.mcpServerCard.deleteServer'), onClick: () => onDeleteServer(serverId, displayName), icon: <Trash2 className="h-4 w-4 mr-2" />, destructive: true, separatorBefore: showAuthButton || connectedWithOAuth })

  return (
    <SettingsListRow
      title={displayName}
      badges={
        <>
          {connectedWithOAuth && (
            <span title={t('settingsPanels.mcpServerCard.oauthAuthenticated')}>
              <Shield className="h-3 w-3 text-muted-foreground" />
            </span>
          )}
          {status ? getStatusBadge(status, t) : (
            <Badge variant="outline" className="text-xs">{t('settingsPanels.mcpServerCard.loading')}</Badge>
          )}
        </>
      }
      description={getServerDescription(serverConfig, t)}
      belowDescription={errorMessage ? (
        <div className="flex items-start gap-1.5 mt-1.5 text-xs text-red-500">
          <XCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />
          <span className="break-words line-clamp-2">{errorMessage}</span>
        </div>
      ) : undefined}
      trailing={
        showAuthButton && onAuthenticate ? (
          <Button
            onClick={() => onAuthenticate(serverId)}
            disabled={isAnyOperationPending || togglingServerId === serverId}
            variant="default"
            size="sm"
          >
            <Key className="h-3 w-3 mr-1" />
            {t('settingsPanels.mcpServerCard.auth')}
          </Button>
        ) : (
          <Switch
            checked={isConnected}
            onCheckedChange={() => onToggleServer(serverId)}
            disabled={isAnyOperationPending || togglingServerId === serverId}
          />
        )
      }
      actions={actions}
      actionsLabel={t('settingsPanels.mcpServerCard.actionsFor', { name: displayName })}
    />
  )
}
