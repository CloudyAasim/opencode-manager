import { useGitLog } from '@/api/git'
import { PanelMessage } from '@/components/ui/panel-message'
import { PanelLoading } from '@/components/ui/panel-loading'
import { GitCommit, AlertCircle, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { GIT_UI_COLORS } from '@/lib/git-status-styles'
import { useI18n } from '@/lib/i18n'

interface CommitsTabProps {
  repoId: number
  branch: string
  onSelectCommit?: (hash: string) => void
}

export function CommitsTab({ repoId, branch, onSelectCommit }: CommitsTabProps) {
  const { t } = useI18n()
  const { data, isLoading, error } = useGitLog(repoId, 50, branch)

  const formatRelativeTime = (timestamp: string): string => {
    const date = new Date(parseInt(timestamp, 10) * 1000)

    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffSeconds = Math.floor(diffMs / 1000)
    const diffMinutes = Math.floor(diffSeconds / 60)
    const diffHours = Math.floor(diffMinutes / 60)
    const diffDays = Math.floor(diffHours / 24)
    const diffWeeks = Math.floor(diffDays / 7)
    const diffMonths = Math.floor(diffDays / 30)

    if (diffSeconds < 60) return t('misc.commitsTab.justNow')
    if (diffMinutes < 60) return t('misc.commitsTab.minutesAgo', { n: diffMinutes })
    if (diffHours < 24) return t('misc.commitsTab.hoursAgo', { n: diffHours })
    if (diffDays < 7) return t('misc.commitsTab.daysAgo', { n: diffDays })
    if (diffWeeks < 4) return t('misc.commitsTab.weeksAgo', { n: diffWeeks })
    return t('misc.commitsTab.monthsAgo', { n: diffMonths })
  }

  if (isLoading) {
    return (
      <PanelLoading size="sm" />
    )
  }

  if (error) {
    return (
      <PanelMessage
        icon={<AlertCircle />}
        title={t('misc.commitsTab.loadFailed')}
        detail={error.message}
      />
    )
  }

  if (!data?.commits || data.commits.length === 0) {
    return (
      <PanelMessage icon={<GitCommit />} title={t('misc.commitsTab.noCommits')} />
    )
  }

  return (
    <div className="flex flex-col h-full overflow-x-hidden">
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {data.commits.map((commit) => (
          <button
            key={commit.hash}
            className="flex items-start gap-3 px-3 py-2 text-left hover:bg-accent/50 transition-colors border-b border-border last:border-0"
            onClick={() => onSelectCommit?.(commit.hash)}
          >
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent flex items-center justify-center mt-0.5">
              <GitCommit className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium line-clamp-2">{commit.message}</p>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground overflow-hidden">
                <span className="font-mono">{commit.hash.substring(0, 7)}</span>
                <span>·</span>
                <span className="truncate">{commit.authorName}</span>
                <span>·</span>
                <span className="flex-shrink-0">{formatRelativeTime(commit.date)}</span>
                {commit.unpushed && (
                  <span className={cn('flex items-center gap-0.5 px-1 rounded', GIT_UI_COLORS.unpushed)}>
                    <ArrowUp className="w-3 h-3" />
                    {t('misc.commitsTab.local')}
                  </span>
                )}
                {!commit.unpushed && (
                  <span className={cn('flex items-center gap-0.5 px-1 rounded', GIT_UI_COLORS.pushed)}>
                    {t('misc.commitsTab.remote')}
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
