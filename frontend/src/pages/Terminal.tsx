import { useQuery } from '@tanstack/react-query'
import { PanelLoading } from '@/components/ui/panel-loading'
import { TerminalSquare } from 'lucide-react'
import { terminalApi } from '@/api/terminal'
import { useI18n } from '@/lib/i18n'
import { useAuth } from '@/hooks/useAuth'
import { TerminalView } from '@/features/terminal/TerminalView'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export function TerminalPage() {
  const { t } = useI18n()
  const { user } = useAuth()
  const configQuery = useQuery({
    queryKey: ['terminal-config'],
    queryFn: terminalApi.getConfig,
    staleTime: 30_000,
  })

  const config = configQuery.data
  const isAdmin = user?.role === 'admin'
  // A missing sandbox only stops the people it protects. An admin is given the
  // whole container on purpose, so refusing them a working feature because a
  // different user's isolation is unavailable would be the wrong trade.
  const sandboxMissing = Boolean(config) && !isAdmin && !config!.sandboxAvailable
  const isUnavailable = config && (!config.enabled || !config.available || config.adminsOnly || sandboxMissing)
  // Said plainly rather than folded into one "unavailable" string, because the
  // cases mean different things to whoever is looking: a setting somebody
  // chose, a host missing a runtime, and a host that cannot confine a shell -
  // the last of which is the one that is a server-side problem.
  const unavailableDescription = !config || config.adminsOnly
    ? config?.adminsOnly ? 'terminal.adminsOnlyDescription' : 'terminal.unavailableDescription'
    : sandboxMissing
      ? 'terminal.sandboxUnavailableDescription'
      : 'terminal.unavailableDescription'

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
        {config?.enabled && config.available && !config.adminsOnly && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {/* `shell` and `cwd` are only sent to an admin, so a non-admin sees
                the sentence that matters to them instead of two empty labels. */}
            {config.shell ? (
              <span>
                {t('terminal.shell')}: <span className="font-mono">{config.shell}</span>
              </span>
            ) : (
              <span>{t('terminal.confinedToWorkspace')}</span>
            )}
            {config.cwd && !config.perUserHome && (
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
          <Alert variant={unavailableDescription === 'terminal.sandboxUnavailableDescription' ? 'destructive' : undefined}>
            <AlertTitle>{t('terminal.unavailableTitle')}</AlertTitle>
            <AlertDescription>{t(unavailableDescription)}</AlertDescription>
          </Alert>
        </div>
      ) : (
        <TerminalView className="min-h-0 flex-1" />
      )}
    </div>
  )
}
