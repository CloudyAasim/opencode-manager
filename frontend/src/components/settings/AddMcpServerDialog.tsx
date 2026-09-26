import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { useMcpServers } from '@/hooks/useMcpServers'
import { settingsApi } from '@/api/settings'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/lib/i18n'

interface AddMcpServerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate: (content: Record<string, unknown>) => Promise<void>
}

interface EnvironmentVariable {
  key: string
  value: string
}

export function AddMcpServerDialog({ open, onOpenChange, onUpdate }: AddMcpServerDialogProps) {
  const { t } = useI18n()
  const [serverId, setServerId] = useState('')
  const [serverType, setServerType] = useState<'local' | 'remote'>('local')
  const [command, setCommand] = useState('')
  const [url, setUrl] = useState('')
  const [environment, setEnvironment] = useState<EnvironmentVariable[]>([])
  const [timeout, setTimeout] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [oauthEnabled, setOauthEnabled] = useState(false)
  const [oauthClientId, setOauthClientId] = useState('')
  const [oauthClientSecret, setOauthClientSecret] = useState('')
  const [oauthScope, setOauthScope] = useState('')
  
  const queryClient = useQueryClient()
  const { addServerAsync, isAddingServer } = useMcpServers()

  const addMcpServerMutation = useMutation({
    mutationFn: async () => {
      const config = await settingsApi.getOpenCodeConfig()
      const currentMcp = (config.content.mcp as Record<string, unknown>) || {}
      
      const mcpConfig: Record<string, unknown> = {
        type: serverType,
        enabled,
      }

      if (serverType === 'local') {
        const commandArray = command.split(' ').filter(arg => arg.trim())
        if (commandArray.length === 0) {
          throw new Error(t('settingsPanels.addMcpServer.commandRequired'))
        }
        mcpConfig.command = commandArray
        
        const envVars: Record<string, string> = {}
        environment.forEach(env => {
          if (env.key.trim() && env.value.trim()) {
            envVars[env.key.trim()] = env.value.trim()
          }
        })
        if (Object.keys(envVars).length > 0) {
          mcpConfig.environment = envVars
        }
      } else {
        if (!url.trim()) {
          throw new Error(t('settingsPanels.addMcpServer.urlRequired'))
        }
        mcpConfig.url = url.trim()
        
        if (oauthEnabled) {
          const oauthConfig: Record<string, string> = {}
          if (oauthClientId.trim()) oauthConfig.clientId = oauthClientId.trim()
          if (oauthClientSecret.trim()) oauthConfig.clientSecret = oauthClientSecret.trim()
          if (oauthScope.trim()) oauthConfig.scope = oauthScope.trim()
          mcpConfig.oauth = Object.keys(oauthConfig).length > 0 ? oauthConfig : true
        }
      }

      if (timeout && parseInt(timeout)) {
        mcpConfig.timeout = parseInt(timeout)
      }

      const updatedConfig = {
        ...config.content,
        mcp: {
          ...currentMcp,
          [serverId]: mcpConfig,
        },
      }

      await onUpdate(updatedConfig)
      
      if (enabled) {
        const buildOauthField = () => {
          if (serverType !== 'remote' || !oauthEnabled) return undefined
          const cfg: Record<string, string> = {}
          if (oauthClientId.trim()) cfg.clientId = oauthClientId.trim()
          if (oauthClientSecret.trim()) cfg.clientSecret = oauthClientSecret.trim()
          if (oauthScope.trim()) cfg.scope = oauthScope.trim()
          return Object.keys(cfg).length > 0 ? cfg : true
        }

        await addServerAsync({ 
          name: serverId, 
          config: {
            type: serverType,
            enabled,
            command: serverType === 'local' ? command.split(' ').filter(arg => arg.trim()) : undefined,
            url: serverType === 'remote' ? url.trim() : undefined,
            environment: serverType === 'local' && Object.keys(environment).length > 0 
              ? environment.reduce((acc, env) => {
                  if (env.key.trim() && env.value.trim()) {
                    acc[env.key.trim()] = env.value.trim()
                  }
                  return acc
                }, {} as Record<string, string>)
              : undefined,
            timeout: timeout && parseInt(timeout) ? parseInt(timeout) : undefined,
            oauth: buildOauthField(),
          }
        })
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-status'] })
      handleClose()
    },
  })

  const handleAddEnvironmentVar = () => {
    setEnvironment([...environment, { key: '', value: '' }])
  }

  const handleRemoveEnvironmentVar = (index: number) => {
    setEnvironment(environment.filter((_, i) => i !== index))
  }

  const handleUpdateEnvironmentVar = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...environment]
    updated[index][field] = value
    setEnvironment(updated)
  }

  const handleAdd = () => {
    if (serverId) {
      addMcpServerMutation.mutate()
    }
  }

  const handleClose = () => {
    setServerId('')
    setServerType('local')
    setCommand('')
    setUrl('')
    setEnvironment([])
    setTimeout('')
    setEnabled(true)
    setOauthEnabled(false)
    setOauthClientId('')
    setOauthClientSecret('')
    setOauthScope('')
    onOpenChange(false)
  }

  const isPending = addMcpServerMutation.isPending || isAddingServer

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent mobileFullscreen className="sm:max-w-3xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6">
        <DialogHeader className="p-4 sm:p-6 border-b flex flex-row items-center justify-between space-y-0">
          <DialogTitle>{t('settingsPanels.addMcpServer.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-2 sm:p-4">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="serverId">{t('settingsPanels.addMcpServer.serverId')}</Label>
              <Input
                id="serverId"
                value={serverId}
                onChange={(e) => setServerId(e.target.value)}
                placeholder={t('settingsPanels.addMcpServer.serverIdPlaceholder')}
                className="bg-background border-border"
              />
              <p className="text-xs text-muted-foreground">
                {t('settingsPanels.addMcpServer.serverIdHint')}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="serverType">{t('settingsPanels.addMcpServer.serverType')}</Label>
              <Select value={serverType} onValueChange={(value: 'local' | 'remote') => setServerType(value)}>
                <SelectTrigger className="bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">{t('settingsPanels.addMcpServer.local')}</SelectItem>
                  <SelectItem value="remote">{t('settingsPanels.addMcpServer.remote')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {serverType === 'local' ? (
              <div className="space-y-1.5">
                <Label htmlFor="command">{t('settingsPanels.addMcpServer.command')}</Label>
                <Input
                  id="command"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder={t('settingsPanels.addMcpServer.commandPlaceholder')}
                  className="bg-background border-border font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  {t('settingsPanels.addMcpServer.commandHint')}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="url">{t('settingsPanels.addMcpServer.serverUrl')}</Label>
                <Input
                  id="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t('settingsPanels.addMcpServer.serverUrlPlaceholder')}
                  className="bg-background border-border font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  {t('settingsPanels.addMcpServer.serverUrlHint')}
                </p>
              </div>
            )}

            {serverType === 'remote' && (
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="oauth"
                    checked={oauthEnabled}
                    onCheckedChange={setOauthEnabled}
                  />
                  <Label htmlFor="oauth">{t('settingsPanels.addMcpServer.enableOauth')}</Label>
                </div>
                {oauthEnabled && (
                  <div className="space-y-3 pl-4 border-l-2 border-border">
                    <p className="text-xs text-muted-foreground">
                      {t('settingsPanels.addMcpServer.oauthHint')}
                    </p>
                    <div className="space-y-1.5">
                      <Label htmlFor="oauthClientId">{t('settingsPanels.addMcpServer.clientId')}</Label>
                      <Input
                        id="oauthClientId"
                        value={oauthClientId}
                        onChange={(e) => setOauthClientId(e.target.value)}
                        placeholder={t('settingsPanels.addMcpServer.optional')}
                        className="bg-background border-border font-mono"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="oauthClientSecret">{t('settingsPanels.addMcpServer.clientSecret')}</Label>
                      <Input
                        id="oauthClientSecret"
                        type="password"
                        value={oauthClientSecret}
                        onChange={(e) => setOauthClientSecret(e.target.value)}
                        placeholder={t('settingsPanels.addMcpServer.optional')}
                        className="bg-background border-border font-mono"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="oauthScope">{t('settingsPanels.addMcpServer.scope')}</Label>
                      <Input
                        id="oauthScope"
                        value={oauthScope}
                        onChange={(e) => setOauthScope(e.target.value)}
                        placeholder={t('settingsPanels.addMcpServer.scopePlaceholder')}
                        className="bg-background border-border font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {serverType === 'local' && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>{t('settingsPanels.addMcpServer.envVars')}</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className='h-6'
                    onClick={handleAddEnvironmentVar}
                  >
                    +
                  </Button>
                </div>
                {environment.map((env, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      value={env.key}
                      onChange={(e) => handleUpdateEnvironmentVar(index, 'key', e.target.value)}
                      placeholder={t('settingsPanels.addMcpServer.apiKeyPlaceholder')}
                      className="bg-background border-border font-mono"
                    />
                    <Input
                      value={env.value}
                      onChange={(e) => handleUpdateEnvironmentVar(index, 'value', e.target.value)}
                      placeholder={t('settingsPanels.addMcpServer.valuePlaceholder')}
                      className="bg-background border-border font-mono"
                    />
                    {environment.length > 1 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => handleRemoveEnvironmentVar(index)}
                      >
                        x
                      </Button>
                    )}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  {t('settingsPanels.addMcpServer.envHint')}
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="timeout">{t('settingsPanels.addMcpServer.timeout')}</Label>
              <Input
                id="timeout"
                value={timeout}
                onChange={(e) => setTimeout(e.target.value)}
                placeholder={t('settingsPanels.addMcpServer.timeoutPlaceholder')}
                className="bg-background border-border"
              />
              <p className="text-xs text-muted-foreground">
                {t('settingsPanels.addMcpServer.timeoutHint')}
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
              <Label htmlFor="enabled">{t('settingsPanels.addMcpServer.connectImmediately')}</Label>
            </div>
          </div>
        </div>

        <DialogFooter className="p-3 sm:p-4 border-t gap-2 pb-4">
          <Button variant="outline" onClick={handleClose} className="flex-1 sm:flex-none">
            {t('settingsPanels.addMcpServer.cancel')}
          </Button>
          <Button
            onClick={handleAdd}
            disabled={!serverId || isPending}
            className="flex-1 sm:flex-none"
          >
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('settingsPanels.addMcpServer.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
