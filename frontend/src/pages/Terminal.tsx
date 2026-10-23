import { useQuery } from '@tanstack/react-query'
import { PanelLoading } from '@/components/ui/panel-loading'
import { TerminalSquare } from 'lucide-react'
import { terminalApi } from '@/api/terminal'
import { useI18n } from '@/lib/i18n'
import { useAuth } from '@/hooks/useAuth'
import { TerminalView } from '@/features/terminal/TerminalView'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Header } from '@/components/ui/header'

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
      <Header>
        <Header.Title
          icon={<TerminalSquare className="h-5 w-5" />}
          description={t('terminal.description')}
        >
          {t('terminal.title')}
        </Header.Title>
        <Header.Actions className="min-w-0">
          {config?.enabled && config.available && !config.adminsOnly && (
            <div className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
              {/* `shell` and `cwd` are only sent to an admin, so a non-admin sees
                  the sentence that matters to them instead of two empty labels. */}
              {config.shell ? (
                <span className="hidden min-w-0 truncate sm:inline">
                  {t('terminal.shell')}: <span className="font-mono">{config.shell}</span>
                </span>
              ) : (
                <span className="min-w-0 truncate">{t('terminal.confinedToWorkspace')}</span>
              )}
              {config.cwd && !config.perUserHome && (
                // The path is the longest thing in the bar, and the bar is one
                // line. On a phone it does not fit beside the page's name -
                // and the name is the one thing that must not be squeezed out
                // of its own title bar. The terminal view says the same path
                // in its own status strip.
                <span className="hidden min-w-0 truncate font-mono sm:inline">
                  {t('terminal.workingDirectory')}: {config.cwd}
                </span>
              )}
            </div>
          )}
        </Header.Actions>
      </Header>

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
