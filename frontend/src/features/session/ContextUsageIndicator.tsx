import { useMediaQuery } from '@/hooks/useMediaQuery'
import { MEDIA } from '@/framework/shell/breakpoints'
import { useContextUsage } from '@/hooks/useContextUsage'
import { useI18n } from '@/lib/i18n'

interface ContextUsageIndicatorProps {
  opcodeUrl: string | null
  sessionID: string | undefined
  directory?: string
  isConnected: boolean
  isReconnecting?: boolean
}

const COMPACT_QUERY = MEDIA.layoutUp

const getUsageTextColor = (percentage: number) => {
  if (percentage < 50) return 'text-success'
  if (percentage < 80) return 'text-warning'
  return 'text-destructive'
}

export function ContextUsageIndicator({ opcodeUrl, sessionID, directory, isConnected, isReconnecting }: ContextUsageIndicatorProps) {
  const { t } = useI18n()
  const isRoomy = useMediaQuery(COMPACT_QUERY)
  const { totalTokens, contextLimit, usagePercentage, isLoading } = useContextUsage(opcodeUrl, sessionID, directory)

  if (isLoading) {
    if (!isRoomy) {
      return (
        <span
          className="h-5 w-5 shrink-0 animate-pulse rounded-full bg-muted-foreground/20"
          title={t('session.contextUsage.loading')}
          aria-label={t('session.contextUsage.loading')}
        />
      )
    }
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('session.contextUsage.loading')}</span>
      </div>
    )
  }

  const percent = Math.round(usagePercentage || 0)

  if (isReconnecting) {
    return isRoomy ? (
      <span className="text-xs text-warning font-medium">{t('session.contextUsage.reconnecting')}</span>
    ) : (
      <span
        className="h-2 w-2 shrink-0 rounded-full bg-warning"
        title={t('session.contextUsage.reconnecting')}
        aria-label={t('session.contextUsage.reconnecting')}
      />
    )
  }

  if (!isConnected) {
    return isRoomy ? (
      <span className="text-xs text-muted-foreground font-medium">{t('session.contextUsage.disconnected')}</span>
    ) : (
      <span
        className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/50"
        title={t('session.contextUsage.disconnected')}
        aria-label={t('session.contextUsage.disconnected')}
      />
    )
  }

  const tokenText = contextLimit
    ? `${totalTokens.toLocaleString()} (${percent}%)`
    : totalTokens.toLocaleString()

  const tooltip = contextLimit
    ? t('session.contextUsage.tooltip', {
        tokens: totalTokens.toLocaleString(),
        percent,
      })
    : tokenText

  if (!isRoomy) {
    return (
      <span
        className={`shrink-0 rounded-full border border-border bg-card px-1.5 py-0.5 text-2xs font-medium tabular-nums ${getUsageTextColor(usagePercentage || 0)}`}
        title={tooltip}
        aria-label={tooltip}
      >
        {contextLimit ? `${percent}%` : tokenText}
      </span>
    )
  }

  return (
    <div
      className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5"
      title={tooltip}
    >
      <span className="text-2xs text-muted-foreground">{t('session.contextUsage.label')}</span>
      <span className={`text-2xs font-medium whitespace-nowrap ${getUsageTextColor(usagePercentage || 0)}`}>
        {contextLimit ? `${percent}%` : tokenText}
      </span>
    </div>
  )
}
