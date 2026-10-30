import { CalendarClock, History, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

type TabType = 'jobs' | 'detail' | 'runs'

interface ScheduleTabMenuProps {
  activeTab: TabType
  onTabChange: (tab: TabType) => void
  className?: string
}

export function ScheduleTabMenu({ activeTab, onTabChange, className }: ScheduleTabMenuProps) {
  const { t } = useI18n()

  return (
    <Tabs
      value={activeTab}
      onValueChange={(next) => onTabChange(next as TabType)}
      className={cn('flex border-t border-border bg-card/80 backdrop-blur-sm pb-1', className)}
    >
      <TabsList variant="bar" className="w-full justify-start">
        <TabsTrigger
          value="jobs"
          variant="bar"
          className="flex-1 flex flex-col items-center gap-1 px-2 py-2 text-muted-foreground data-[state=active]:text-primary"
        >
          <CalendarClock className="size-5" />
          <span>{t('schedules.tabs.jobs')}</span>
        </TabsTrigger>
        <TabsTrigger
          value="detail"
          variant="bar"
          className="flex-1 flex flex-col items-center gap-1 px-2 py-2 text-muted-foreground data-[state=active]:text-primary"
        >
          <Info className="size-5" />
          <span>{t('schedules.tabs.detail')}</span>
        </TabsTrigger>
        <TabsTrigger
          value="runs"
          variant="bar"
          className="flex-1 flex flex-col items-center gap-1 px-2 py-2 text-muted-foreground data-[state=active]:text-primary"
        >
          <History className="size-5" />
          <span>{t('schedules.tabs.runs')}</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
