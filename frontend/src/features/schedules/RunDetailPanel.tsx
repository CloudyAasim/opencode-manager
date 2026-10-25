import { useNavigate } from 'react-router-dom'
import { PanelLoading } from '@/components/ui/panel-loading'
import { PanelMessage } from '@/components/ui/panel-message'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScheduleRunMarkdown } from '@/features/schedules/ScheduleRunMarkdown'
import { Loader2, ScrollText } from 'lucide-react'
import type { ScheduleRun } from '@opencode-manager/shared/types'
import { useI18n } from '@/lib/i18n'

interface RunDetailPanelProps {
  repoId: number
  activeRun: ScheduleRun | null
  selectedRunLoading: boolean
  onCancelRun: () => void
  cancelRunPending: boolean
}

export function RunDetailPanel({ repoId, activeRun, selectedRunLoading, onCancelRun, cancelRunPending }: RunDetailPanelProps) {
  const navigate = useNavigate()
  const { t } = useI18n()

  if (selectedRunLoading && !activeRun) {
    return (
      <PanelLoading className="h-full" size="md" />
    )
  }

  if (!activeRun) {
    return (
      <PanelMessage
        icon={<ScrollText />}
        title={t('schedules.runs.selectRunTitle')}
        detail={t('schedules.runs.selectRunHint')}
        size="sm"
        className="h-full"
      />
    )
  }

  return (
    <Tabs key={`${activeRun.id}-${String(activeRun.responseText ? 'response' : activeRun.errorText ? 'error' : 'log')}`} defaultValue={activeRun.responseText ? 'response' : activeRun.errorText ? 'error' : 'log'} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-center gap-2 px-2 py-1.5">
        <TabsList variant="bar">
          <TabsTrigger value="log" variant="bar" className="px-3 py-1.5">{t('schedules.runs.log')}</TabsTrigger>
          <TabsTrigger value="response" disabled={!activeRun.responseText} variant="bar" className="px-3 py-1.5">{t('schedules.runs.assistantOutput')}</TabsTrigger>
          <TabsTrigger value="error" disabled={!activeRun.errorText} variant="bar" className="px-3 py-1.5">{activeRun.status === 'cancelled' ? t('schedules.runs.details') : t('schedules.runs.error')}</TabsTrigger>
        </TabsList>
      </div>
      {(activeRun.status === 'running' || activeRun.sessionId || activeRun.responseText) && (
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="flex items-center gap-2">
            {activeRun.sessionId && (
              <Button variant="outline" size="sm" onClick={() => navigate(`/repos/${repoId}/sessions/${activeRun.sessionId}`)}>
                {t('schedules.runs.openSession')}
              </Button>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={onCancelRun} disabled={cancelRunPending || activeRun.status !== 'running'}>
            {cancelRunPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('schedules.runs.cancelRun')}
          </Button>
        </div>
      )}
      <TabsContent value="log" className="mt-0 min-h-0 flex-1 overflow-y-auto px-0 py-3 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]">
        {selectedRunLoading && !activeRun ? (
          <PanelLoading className="p-4" size="md" />
        ) : (
          <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6">{activeRun.logText ?? t('schedules.runs.noLogText')}</pre>
        )}
      </TabsContent>
      <TabsContent value="response" className="mt-0 min-h-0 flex-1 flex flex-col overflow-hidden">
        {selectedRunLoading && !activeRun ? (
          <PanelLoading className="p-4" size="md" />
        ) : activeRun.responseText ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-0 py-2 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]">
            <ScheduleRunMarkdown content={activeRun.responseText} />
          </div>
        ) : (
          <div className="p-3"><pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6">{t('schedules.runs.noAssistantOutput')}</pre></div>
        )}
      </TabsContent>
      <TabsContent value="error" className="mt-0 min-h-0 flex-1 overflow-y-auto px-0 py-3 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]">
        {selectedRunLoading && !activeRun ? (
          <PanelLoading className="p-4" size="md" />
        ) : (
          <pre className={`whitespace-pre-wrap break-words text-sm font-mono leading-6 ${activeRun.status === 'cancelled' ? 'text-muted-foreground' : 'text-destructive'}`}>{activeRun.errorText ?? t('schedules.runs.noErrorRecorded')}</pre>
        )}
      </TabsContent>
    </Tabs>
  )
}
