import { useQuery } from '@tanstack/react-query'
import { CalendarClock, CircleCheck, FolderGit2, FolderOpen, Plus } from 'lucide-react'
import { listRepos } from '@/api/repos'
import { useAllSchedules } from '@/hooks/useSchedules'
import { useI18n } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

interface WorkspaceDashboardProps {
  onNewRepo: () => void
  onOpenFiles: () => void
  onOpenSchedules: () => void
}

export function WorkspaceDashboard({ onNewRepo, onOpenFiles, onOpenSchedules }: WorkspaceDashboardProps) {
  const { t } = useI18n()
  const { data: repos } = useQuery({ queryKey: ['repos'], queryFn: listRepos, staleTime: 60_000 })
  const { data: schedules } = useAllSchedules()

  const repoCount = (repos ?? []).filter((repo) => repo.id !== 0).length
  const scheduleCount = schedules?.length ?? 0
  const enabledCount = (schedules ?? []).filter((job) => (job as { enabled?: boolean }).enabled !== false).length

  const stats = [
    { key: 'repos', icon: FolderGit2, label: t('home.stats.repos'), value: repoCount },
    { key: 'schedules', icon: CalendarClock, label: t('home.stats.schedules'), value: scheduleCount },
    { key: 'enabled', icon: CircleCheck, label: t('home.stats.enabled'), value: enabledCount },
  ]

  return (
    <section className="mb-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{t('home.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('home.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onOpenFiles}>
            <FolderOpen className="w-4 h-4" />
            {t('home.files')}
          </Button>
          <Button variant="outline" size="sm" onClick={onOpenSchedules}>
            <CalendarClock className="w-4 h-4" />
            {t('home.schedules')}
          </Button>
          <Button size="sm" onClick={onNewRepo}>
            <Plus className="w-4 h-4" />
            {t('home.newRepo')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.key} className="flex items-center gap-4 p-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <stat.icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="text-2xl font-semibold leading-none text-foreground">{stat.value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{stat.label}</div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  )
}
