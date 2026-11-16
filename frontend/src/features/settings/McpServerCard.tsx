import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { SettingsListRow, type SettingsListRowAction } from '@/components/ui/settings-list'
import { XCircle, AlertCircle, Key, Shield, Trash2, RefreshCw } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import type { McpServer } from '@/api/mcp'

type Translate = ReturnType<typeof useI18n>['t']

interface McpServerCardProps {
  serverId: string
  /**
   * What the agent says about this server, when it has said anything.
   *
   * It may have said nothing: a server that is written down but has not been
   * picked up yet is one whose state is unknown, and it is drawn as such
   * rather than as a server that is not there.
   */
  server?: McpServer
  errorMessage: string | null
  isAnyOperationPending: boolean
  togglingServerId: string | null
  isRemovingAuth: boolean
  onToggleServer: (serverId: string) => void
  onAuthenticate?: (serverId: string) => void
  onRemoveAuth?: (serverId: string) => void
  onDeleteServer: (serverId: string, serverName: string) => void
}

function getStatusBadge(server: McpServer, t: Translate) {
  switch (server.state) {
    case 'connected':
      return <Badge variant="success">{t('settingsPanels.mcpServerCard.connected')}</Badge>
    case 'disabled':
      return <Badge variant="secondary">{t('settingsPanels.mcpServerCard.disabled')}</Badge>
    case 'failed':
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          <AlertCircle className="size-3" />
          {t('settingsPanels.mcpServerCard.failed')}
        </Badge>
      )
    case 'needs_auth':
      return (
        <Badge variant="outline-warning" className="flex items-center gap-1">
          <Key className="size-3" />
          {t('settingsPanels.mcpServerCard.authRequired')}
        </Badge>
      )
    case 'needs_client_registration':
      return (
        <Badge variant="outline-warning" className="flex items-center gap-1 text-primary">
          <AlertCircle className="size-3" />
          {t('settingsPanels.mcpServerCard.registrationRequired')}
        </Badge>
      )
    default:
      return <Badge variant="outline">{t('settingsPanels.mcpServerCard.unknown')}</Badge>
  }
}

function getServerDisplayName(serverId: string): string {
  const name = serverId.replace(/[-_]/g, ' ')
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function getServerDescription(server: McpServer | undefined, t: Translate): string {
  if (server?.kind === 'local' && server.command) {
    const command = server.command.join(' ')
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
  } else if (server?.kind === 'remote' && server.url) {
    return t('settingsPanels.mcpServerCard.remoteServer', { url: server.url })
  }
  return t('settingsPanels.mcpServerCard.mcpServer')
}

export function McpServerCard({
  serverId,
  server,
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
  const needsAuth = server?.state === 'needs_auth'
  const isRemote = server?.kind === 'remote'
  const hasOAuthConfig = isRemote && !!server?.oauth
  const hasOAuthError = server?.state === 'failed' && isRemote && /oauth|auth.*state/i.test(server.detail ?? '')
  const isOAuthServer = hasOAuthConfig || hasOAuthError || (needsAuth && isRemote)
  const isConnected = server?.state === 'connected'
  const connectedWithOAuth = isOAuthServer && isConnected
  const showAuthButton = needsAuth || (isOAuthServer && server?.state === 'failed')
  const displayName = getServerDisplayName(serverId)

  const actions: SettingsListRowAction[] = []
  if (showAuthButton && onAuthenticate) {
    actions.push({ label: t('settingsPanels.mcpServerCard.authenticate'), onClick: () => onAuthenticate(serverId), icon: <Key className="size-4 mr-2" /> })
  }
  if (connectedWithOAuth && onAuthenticate) {
    actions.push({ label: t('settingsPanels.mcpServerCard.reauthenticate'), onClick: () => onAuthenticate(serverId), icon: <RefreshCw className="size-4 mr-2" /> })
  }
  if (connectedWithOAuth && onRemoveAuth) {
    actions.push({ label: isRemovingAuth ? t('settingsPanels.mcpServerCard.removing') : t('settingsPanels.mcpServerCard.removeAuth'), onClick: () => onRemoveAuth(serverId), icon: <Shield className="size-4 mr-2" />, disabled: isRemovingAuth })
  }
  actions.push({ label: t('settingsPanels.mcpServerCard.deleteServer'), onClick: () => onDeleteServer(serverId, displayName), icon: <Trash2 className="size-4 mr-2" />, destructive: true, separatorBefore: showAuthButton || connectedWithOAuth })

  return (
    <SettingsListRow
      title={displayName}
      badges={
        <>
          {connectedWithOAuth && (
            <span title={t('settingsPanels.mcpServerCard.oauthAuthenticated')}>
              <Shield className="size-3 text-muted-foreground" />
            </span>
          )}
          {server ? getStatusBadge(server, t) : (
            <Badge variant="outline">{t('settingsPanels.mcpServerCard.loading')}</Badge>
          )}
        </>
      }
      description={getServerDescription(server, t)}
      belowDescription={errorMessage ? (
        <div className="flex items-start gap-1.5 mt-1.5 text-xs text-destructive">
          <XCircle className="size-3 flex-shrink-0 mt-0.5" />
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
            <Key className="size-3 mr-1" />
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
