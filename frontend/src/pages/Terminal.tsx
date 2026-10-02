import { useQuery } from '@tanstack/react-query'
import { PanelLoading } from '@/components/ui/panel-loading'
import { TerminalSquare } from 'lucide-react'
import { terminalApi } from '@/api/terminal'
import { useI18n } from '@/lib/i18n'
import { TerminalView } from '@/features/terminal/TerminalView'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export function TerminalPage() {
  const { t } = useI18n()
  const configQuery = useQuery({
    queryKey: ['terminal-config'],
    queryFn: terminalApi.getConfig,
    staleTime: 30_000,
  })

  const config = configQuery.data
  const isUnavailable = config && (!config.enabled || !config.available)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <TerminalSquare className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold text-foreground">{t('terminal.title')}</h1>
            <p className="text-xs text-muted-foreground">{t('terminal.description')}</p>
          </div>
        </div>
        {config?.enabled && config.available && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>
              {t('terminal.shell')}: <span className="font-mono">{config.shell}</span>
            </span>
            {!config.perUserHome && (
              <span>
                {t('terminal.workingDirectory')}: <span className="font-mono">{config.cwd}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {configQuery.isLoading ? (
        <PanelLoading className="flex-1" size="md" />
      ) : configQuery.isError ? (
        <div className="p-4">
          <Alert variant="destructive">
            <AlertTitle>{t('terminal.unavailableTitle')}</AlertTitle>
            <AlertDescription>{t('terminal.unavailableDescription')}</AlertDescription>
          </Alert>
        </div>
      ) : isUnavailable ? (
        <div className="p-4">
          <Alert>
            <AlertTitle>{t('terminal.unavailableTitle')}</AlertTitle>
            <AlertDescription>{t('terminal.unavailableDescription')}</AlertDescription>
          </Alert>
        </div>
      ) : (
        <TerminalView className="min-h-0 flex-1" />
      )}
    </div>
  )
}
