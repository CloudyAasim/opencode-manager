import { useSettings } from '@/hooks/useSettings'
import { useVersionCheck } from '@/hooks/useVersionCheck'
import { Loader2 } from 'lucide-react'
import { useI18n, SUPPORTED_LOCALES, LOCALE_LABELS, type SupportedLocale } from '@/lib/i18n'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

export function GeneralSettings() {
  const { preferences, isLoading, updateSettings, isUpdating } = useSettings()
  const { data: versionInfo, isLoading: isVersionLoading } = useVersionCheck()
  const { t, locale, setLocale } = useI18n()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-foreground">{t('settings.general.title')}</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>OpenCode Manager</span>
          {isVersionLoading ? (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          ) : versionInfo?.currentVersion ? (
            <>
              <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
                {versionInfo.currentVersion}
              </span>
              {versionInfo.updateAvailable && versionInfo.latestVersion && (
                <a
                  href={versionInfo.releaseUrl ?? ''}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-green-500 hover:text-green-400 transition-colors"
                >
                  {t('settings.general.updateAvailable', { version: `v${versionInfo.latestVersion}` })}
                </a>
              )}
            </>
          ) : (
            <span>{t('common.unknown')}</span>
          )}
        </div>
      </div>

      <div className="divide-y divide-border">
        <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0 space-y-0.5">
            <Label htmlFor="language">{t('settings.general.language')}</Label>
            <p className="text-sm text-muted-foreground">
              {t('settings.general.languageDescription')}
            </p>
          </div>
          <Select value={locale} onValueChange={(value) => setLocale(value as SupportedLocale)}>
            <SelectTrigger id="language" className="w-full shrink-0 sm:w-40">
              <SelectValue placeholder={t('settings.general.selectLanguage')} />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_LOCALES.map((supported) => (
                <SelectItem key={supported} value={supported}>
                  {LOCALE_LABELS[supported]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0 space-y-0.5">
            <Label htmlFor="theme">{t('settings.general.theme')}</Label>
            <p className="text-sm text-muted-foreground">
              {t('settings.general.themeDescription')}
            </p>
          </div>
          <Select
            value={preferences?.theme || 'dark'}
            onValueChange={(value) => updateSettings({ theme: value as 'dark' | 'light' | 'system' })}
          >
            <SelectTrigger id="theme" className="w-full shrink-0 sm:w-40">
              <SelectValue placeholder={t('settings.general.theme')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">{t('settings.general.themeDark')}</SelectItem>
              <SelectItem value="light">{t('settings.general.themeLight')}</SelectItem>
              <SelectItem value="system">{t('settings.general.themeSystem')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0 space-y-0.5">
            <Label htmlFor="simpleChatMode">{t('settings.general.simpleChatMode')}</Label>
            <p className="text-sm text-muted-foreground">
              {t('settings.general.simpleChatModeDescription')}
            </p>
          </div>
          <Switch
            id="simpleChatMode"
            checked={preferences?.simpleChatMode ?? false}
            onCheckedChange={(checked) => updateSettings({ simpleChatMode: checked })}
          />
        </div>

        <div className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0 space-y-0.5">
            <Label htmlFor="autoScroll">{t('settings.general.autoScroll')}</Label>
            <p className="text-sm text-muted-foreground">
              {t('settings.general.autoScrollDescription')}
            </p>
          </div>
          <Switch
            id="autoScroll"
            checked={preferences?.autoScroll ?? true}
            onCheckedChange={(checked) => updateSettings({ autoScroll: checked })}
          />
        </div>

        {!preferences?.simpleChatMode && (
          <>
            <div className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="showReasoning">{t('settings.general.showReasoning')}</Label>
                <p className="text-sm text-muted-foreground">
                  {t('settings.general.showReasoningDescription')}
                </p>
              </div>
              <Switch
                id="showReasoning"
                checked={preferences?.showReasoning ?? false}
                onCheckedChange={(checked) => updateSettings({ showReasoning: checked })}
              />
            </div>

            <div className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="expandToolCalls">{t('settings.general.expandToolCalls')}</Label>
                <p className="text-sm text-muted-foreground">
                  {t('settings.general.expandToolCallsDescription')}
                </p>
              </div>
              <Switch
                id="expandToolCalls"
                checked={preferences?.expandToolCalls ?? false}
                onCheckedChange={(checked) => updateSettings({ expandToolCalls: checked })}
              />
            </div>

            <div className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="expandDiffs">{t('settings.general.expandDiffs')}</Label>
                <p className="text-sm text-muted-foreground">
                  {t('settings.general.expandDiffsDescription')}
                </p>
              </div>
              <Switch
                id="expandDiffs"
                checked={preferences?.expandDiffs ?? true}
                onCheckedChange={(checked) => updateSettings({ expandDiffs: checked })}
              />
            </div>
          </>
        )}
      </div>

      {isUpdating && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t('settings.general.saving')}</span>
        </div>
      )}
    </div>
  )
}
