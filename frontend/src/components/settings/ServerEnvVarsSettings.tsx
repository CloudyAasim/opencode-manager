import { useState, useEffect, useMemo } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Plus, Trash2, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { showToast } from '@/lib/toast'
import { BLOCKED_SERVER_ENV_KEYS, DEFAULT_SERVER_ENV_VARS } from '@/api/types/settings'
import { SettingsDisclosure } from './SettingsDisclosure'
import { useI18n } from '@/lib/i18n'

interface EnvVar {
  key: string
  value: string
}

export function ServerEnvVarsSettings() {
  const { t } = useI18n()
  const { preferences, updateSettingsAsync, isUpdating } = useSettings()
  const [isOpen, setIsOpen] = useState(false)
  const [envVars, setEnvVars] = useState<EnvVar[]>([])
  const [disabledDefaultKeys, setDisabledDefaultKeys] = useState<string[]>([])
  const [needsRestart, setNeedsRestart] = useState(false)

  useEffect(() => {
    setEnvVars(preferences?.serverEnvVars ?? [])
    setDisabledDefaultKeys(preferences?.disabledDefaultServerEnvVars ?? [])
  }, [preferences?.disabledDefaultServerEnvVars, preferences?.serverEnvVars])

  const blockedSet = useMemo(() => new Set<string>(BLOCKED_SERVER_ENV_KEYS), [])

  const blockedKeys = useMemo(
    () => envVars
      .map((envVar) => envVar.key.trim())
      .filter((key) => key.length > 0 && blockedSet.has(key)),
    [envVars, blockedSet],
  )

  const disabledDefaultSet = useMemo(() => new Set(disabledDefaultKeys), [disabledDefaultKeys])
  const enabledDefaultCount = DEFAULT_SERVER_ENV_VARS.filter((envVar) => !disabledDefaultSet.has(envVar.key)).length

  const handleDefaultToggle = (key: string, enabled: boolean) => {
    setDisabledDefaultKeys((prev) => enabled
      ? prev.filter((disabledKey) => disabledKey !== key)
      : [...new Set([...prev, key])])
  }

  const handleAdd = () => {
    setEnvVars((prev) => [...prev, { key: '', value: '' }])
  }

  const handleRemove = (index: number) => {
    setEnvVars((prev) => prev.filter((_, i) => i !== index))
  }

  const handleChange = (index: number, field: keyof EnvVar, value: string) => {
    setEnvVars((prev) => prev.map((envVar, i) => (i === index ? { ...envVar, [field]: value } : envVar)))
  }

  const handleSave = async () => {
    if (blockedKeys.length > 0) return

    const filtered = envVars.filter((envVar) => envVar.key.trim() !== '')

    try {
      await updateSettingsAsync({
        serverEnvVars: filtered,
        disabledDefaultServerEnvVars: disabledDefaultKeys,
      })
      setNeedsRestart(true)
      showToast.success(t('settingsPanels.serverEnv.saved'))
    } catch {
      showToast.error(t('settingsPanels.serverEnv.saveFailed'))
    }
  }

  return (
    <SettingsDisclosure
      title={t('settingsPanels.serverEnv.title')}
      isOpen={isOpen}
      onToggle={() => setIsOpen((value) => !value)}
      contentClassName="space-y-3"
      meta={
        <Badge variant="outline" className="text-xs">
          {enabledDefaultCount + (preferences?.serverEnvVars ?? []).length}
        </Badge>
      }
    >
      {needsRestart && (
        <Alert>
          <RotateCcw className="h-4 w-4" />
          <AlertDescription>
            {t('settingsPanels.serverEnv.restartRequired')}
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <div className="rounded-md bg-muted/20 p-3 space-y-2">
          <div className="text-xs font-medium text-muted-foreground">{t('settingsPanels.serverEnv.defaultVariables')}</div>
          {DEFAULT_SERVER_ENV_VARS.map((envVar) => {
            const isEnabled = !disabledDefaultSet.has(envVar.key)

            return (
              <div key={envVar.key} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-xs truncate">{envVar.key}={envVar.value}</div>
                  <p className="text-xs text-muted-foreground">
                    {t('settingsPanels.serverEnv.defaultHint')}
                  </p>
                </div>
                <Switch
                  checked={isEnabled}
                  onCheckedChange={(checked) => handleDefaultToggle(envVar.key, checked)}
                  aria-label={t('settingsPanels.serverEnv.toggle', { key: envVar.key })}
                />
              </div>
            )
          })}
        </div>

        {envVars.map((envVar, index) => {
          const isBlocked = blockedSet.has(envVar.key.trim())

          return (
            <div key={index} className="flex gap-2 items-center">
              <div className="flex-1 flex gap-2">
                <Input
                  value={envVar.key}
                  onChange={(event) => handleChange(index, 'key', event.target.value)}
                  placeholder={t('settingsPanels.serverEnv.namePlaceholder')}
                  className={`font-mono ${isBlocked ? 'border-destructive' : ''}`}
                />
                <Input
                  value={envVar.value}
                  onChange={(event) => handleChange(index, 'value', event.target.value)}
                  placeholder={t('settingsPanels.serverEnv.valuePlaceholder')}
                  className="font-mono"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => handleRemove(index)}
                aria-label={t('common.delete')}
                title={t('common.delete')}
                className="shrink-0"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )
        })}
        {blockedKeys.length > 0 && (
          <p className="text-xs text-destructive">
            {t('settingsPanels.serverEnv.reservedKeys', { keys: blockedKeys.join(', ') })}
          </p>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
          <Plus className="h-3 w-3 mr-1" />
          {t('settingsPanels.serverEnv.addVariable')}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={isUpdating || blockedKeys.length > 0}
        >
          {isUpdating ? t('settingsPanels.serverEnv.saving') : t('settingsPanels.serverEnv.save')}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {t('settingsPanels.serverEnv.footer')}
      </p>
    </SettingsDisclosure>
  )
}
