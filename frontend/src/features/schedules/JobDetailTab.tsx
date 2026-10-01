import type { ScheduleJob } from '@opencode-manager/shared/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  formatScheduleSummary,
  formatTimestamp,
  getJobStatusTone,
  hasSkillMetadata,
} from './schedule-utils'
import { Bot, CalendarClock, Clock3, History, Loader2, Pencil, Play, Sparkles, Trash2 } from 'lucide-react'
import { useScheduleModels } from '@/hooks/useScheduleModels'
import { resolveScheduleModel } from '@/lib/schedules/schedule-model'
import { useI18n } from '@/lib/i18n'

interface JobDetailTabProps {
  selectedJob: ScheduleJob | undefined
  onEdit: (job: ScheduleJob) => void
  onDelete: (jobId: number) => void
  onToggleEnabled: () => void
  onRunNow: () => void
  updatePending: boolean
  runPending: boolean
  runningRun: boolean
  isJobFetching: boolean
}

export function JobDetailTab({
  selectedJob,
  onEdit,
  onDelete,
  onToggleEnabled,
  onRunNow,
  updatePending,
  runPending,
  runningRun,
  isJobFetching,
}: JobDetailTabProps) {
  const { t } = useI18n()
  const { availableModelKeys, configDefaultModel } = useScheduleModels(Boolean(selectedJob))
  const resolvedModel = resolveScheduleModel(selectedJob?.model, availableModelKeys, configDefaultModel)

  if (!selectedJob) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <CalendarClock className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
          <p className="text-lg font-medium">{t('schedules.jobDetail.noJobSelected')}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t('schedules.jobDetail.selectJobToViewDetails')}</p>
        </div>
      </div>
    )
  }

  const runButtonLabel = runningRun
    ? t('schedules.jobDetail.runInProgress')
    : isJobFetching
      ? t('schedules.jobDetail.refreshing')
      : t('schedules.jobDetail.runNow')

  return (
    <div className="h-full overflow-y-auto">
      <section className="overflow-hidden rounded-xl bg-card/40">
        <div className="border-b border-border/60 bg-card px-3 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-semibold tracking-tight">{selectedJob.name}</h3>
                <Badge className={getJobStatusTone(selectedJob)}>{selectedJob.enabled ? t('schedules.common.enabled') : t('schedules.common.paused')}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{selectedJob.description || t('schedules.common.noDescriptionProvided')}</p>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {formatTimestamp(t, selectedJob.nextRunAt)}</span>
                <span className="inline-flex items-center gap-1"><History className="h-3.5 w-3.5" /> {t('schedules.jobDetail.lastRun')} {formatTimestamp(t, selectedJob.lastRunAt)}</span>
                <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> {formatScheduleSummary(t, selectedJob)}</span>
                <span className="inline-flex items-center gap-1"><Bot className="h-3.5 w-3.5" /> {selectedJob.agentSlug ?? t('schedules.common.defaultAgent')}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={onToggleEnabled} disabled={updatePending}>
                {selectedJob.enabled ? t('schedules.common.pause') : t('schedules.common.enable')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => onEdit(selectedJob)} title={t('schedules.common.edit')}>
                <Pencil className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{t('schedules.common.edit')}</span>
              </Button>
              <Button variant="outline" size="sm" onClick={onRunNow} disabled={runPending || runningRun || isJobFetching} title={runButtonLabel}>
                {runPending || isJobFetching ? <Loader2 className="h-4 w-4 sm:mr-2 animate-spin" /> : <Play className="h-4 w-4 sm:mr-2" />}
                <span className="hidden sm:inline">{runButtonLabel}</span>
              </Button>
              <Button variant="destructive" size="sm" onClick={() => onDelete(selectedJob.id)} title={t('schedules.common.delete')}>
                <Trash2 className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{t('schedules.common.delete')}</span>
              </Button>
            </div>
          </div>
        </div>

        <div className="p-3 sm:p-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-4">
              <section className="rounded-lg border border-border/60 bg-background/40 p-3 sm:p-4">
                <div className="mb-3">
                  <h3 className="text-base font-medium">{t('schedules.jobDetail.executionPrompt')}</h3>
                  <p className="text-sm text-muted-foreground">{t('schedules.jobDetail.executionPromptHint')}</p>
                </div>
                <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6 text-foreground/90">{selectedJob.prompt}</pre>
              </section>

                {hasSkillMetadata(selectedJob) && (
                  <section className="rounded-lg border border-border/60 bg-background/40 p-3 sm:p-4">
                  <div className="mb-3">
                    <h3 className="text-base font-medium flex items-center gap-2"><Sparkles className="h-4 w-4" /> {t('schedules.jobDetail.advancedMetadata')}</h3>
                    <p className="text-sm text-muted-foreground">{t('schedules.jobDetail.advancedMetadataHint')}</p>
                  </div>
                  <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6 text-foreground/90">{JSON.stringify(selectedJob.skillMetadata, null, 2)}</pre>
                </section>
              )}
            </div>

            <Card className="border-border/60 bg-background/60 shadow-none">
              <CardHeader>
                <CardTitle className="text-base">{t('schedules.jobDetail.executionSettings')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="text-muted-foreground">{t('schedules.jobDetail.schedule')}</p>
                  <p className="font-medium break-words">{formatScheduleSummary(t, selectedJob)}</p>
                  {selectedJob.scheduleMode === 'cron' && selectedJob.cronExpression && (
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{selectedJob.cronExpression}</p>
                  )}
                </div>
                <div>
                  <p className="text-muted-foreground">{t('schedules.jobDetail.agent')}</p>
                  <p className="font-medium">{selectedJob.agentSlug ?? t('schedules.common.defaultAgentCapitalized')}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('schedules.jobDetail.model')}</p>
                  <p className="font-medium break-all">{resolvedModel ?? t('schedules.common.workspaceDefault')}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('schedules.jobDetail.created')}</p>
                  <p className="font-medium">{formatTimestamp(t, selectedJob.createdAt)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('schedules.jobDetail.updated')}</p>
                  <p className="font-medium">{formatTimestamp(t, selectedJob.updatedAt)}</p>
                </div>
                {selectedJob.branch && (
                  <div>
                    <p className="text-muted-foreground">{t('schedules.common.baseBranch')}</p>
                    <p className="font-medium font-mono">{selectedJob.branch}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </div>
  )
}
