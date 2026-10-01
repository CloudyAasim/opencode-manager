import { usePermissions, useQuestions, useSSEHealth } from '@/contexts/EventContext'
import { useServerHealth } from '@/hooks/useServerHealth'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type Tone = 'ok' | 'warn' | 'bad' | 'idle'

const TONE_CLASS: Record<Tone, string> = {
  ok: 'bg-status-completed',
  warn: 'bg-status-running',
  bad: 'bg-status-failed',
  idle: 'bg-status-idle',
}

function Dot({ tone }: { tone: Tone }) {
  return <span className={cn('inline-block size-1.5 shrink-0 rounded-full', TONE_CLASS[tone])} />
}

export function StatusBar() {
  const { t } = useI18n()
  const permissions = usePermissions()
  const questions = useQuestions()
  const sse = useSSEHealth()
  const { data: health, isError } = useServerHealth()

  const pending = permissions.pendingCount + questions.pendingCount
  const healthStatus = isError ? 'unhealthy' : health?.status ?? 'healthy'
  const tone: Tone =
    !sse.isConnected || sse.isStalled || healthStatus === 'unhealthy'
      ? 'bad'
      : healthStatus === 'degraded' || !sse.isHealthy
        ? 'warn'
        : 'ok'
  const label = !sse.isConnected || sse.isStalled
    ? t('shell.status.offline')
    : healthStatus === 'healthy'
      ? t('shell.status.healthy')
      : t('shell.status.degraded')

  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-card px-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Dot tone={tone} />
        {label}
      </span>

      {health?.opencodeVersion && (
        <span className="hidden sm:inline">OpenCode {health.opencodeVersion}</span>
      )}

      {health?.opencodeManagerVersion && (
        <span className="hidden md:inline">Manager {health.opencodeManagerVersion}</span>
      )}

      <span className="flex-1" />

      {pending > 0 && (
        <span className="flex items-center gap-1.5 text-status-running-text">
          <Dot tone="warn" />
          {t('shell.status.pending', { count: pending })}
        </span>
      )}
    </div>
  )
}
