import { memo, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { FolderGit2, FolderOpen, Bell, CalendarClock, Menu, Info, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMobile } from '@/hooks/useMobile'
import { useMobileTabBar, useScheduleTab, type ScheduleTabKey } from '@/hooks/useMobileTabBar'
import { usePendingAlerts } from '@/contexts/EventContext'

interface TabDef {
  key: string
  label: string
  icon: React.ElementType
  onClick: () => void
  active: boolean
  badge?: boolean
}

interface GlobalTabsArgs {
  pathname: string
  openSheet: ReturnType<typeof useMobileTabBar>['openSheet']
  open: ReturnType<typeof useMobileTabBar>['open']
  navigate: ReturnType<typeof useNavigate>
  hasPending: boolean
  isInsideRepo: boolean
  repoId: string | null
}

function buildGlobalTabs({ pathname, openSheet, open, navigate, hasPending, isInsideRepo, repoId }: GlobalTabsArgs): TabDef[] {
  const handleFilesClick = () => {
    if (isInsideRepo && repoId) {
      const newParams = new URLSearchParams({ dialog: 'files' })
      navigate(`${pathname}?${newParams.toString()}`, { replace: true })
    } else {
      open('files')
    }
  }

  return [
    {
      key: 'repos',
      label: 'Repos',
      icon: FolderGit2,
      onClick: () => open('repos'),
      active: openSheet === 'repos' || (pathname === '/' && !openSheet),
    },
    {
      key: 'files',
      label: 'Files',
      icon: FolderOpen,
      onClick: handleFilesClick,
      active: openSheet === 'files',
    },
    {
      key: 'notifications',
      label: 'Alerts',
      icon: Bell,
      onClick: () => open('notifications'),
      badge: hasPending,
      active: openSheet === 'notifications',
    },
    {
      key: 'schedules',
      label: 'Schedules',
      icon: CalendarClock,
      onClick: () => navigate('/schedules'),
      active: pathname === '/schedules' && !openSheet,
    },
    {
      key: 'more',
      label: 'More',
      icon: Menu,
      onClick: () => open('more'),
      active: openSheet === 'more',
    },
  ]
}

function buildScheduleTabs(scheduleTab: ScheduleTabKey, setScheduleTab: (tab: ScheduleTabKey) => void): TabDef[] {
  return [
    {
      key: 'jobs',
      label: 'Jobs',
      icon: CalendarClock,
      onClick: () => setScheduleTab('jobs'),
      active: scheduleTab === 'jobs',
    },
    {
      key: 'detail',
      label: 'Detail',
      icon: Info,
      onClick: () => setScheduleTab('detail'),
      active: scheduleTab === 'detail',
    },
    {
      key: 'runs',
      label: 'Runs',
      icon: History,
      onClick: () => setScheduleTab('runs'),
      active: scheduleTab === 'runs',
    },
  ]
}

interface TabBarRowProps {
  tabs: TabDef[]
}

const TabBarRow = memo(function TabBarRow({ tabs }: TabBarRowProps) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-40 flex border-t border-border bg-card/90 backdrop-blur-sm pb-safe">
      {tabs.map((tab) => {
        const Icon = tab.icon
        return (
          <button
            key={tab.key}
            type="button"
            className={cn(
              'relative flex-1 flex flex-col items-center justify-center gap-1 px-2 py-2 text-xs font-medium border-b-2 transition-colors',
              tab.active
                ? 'text-primary border-primary'
                : 'text-muted-foreground border-transparent hover:text-foreground',
            )}
            onClick={tab.onClick}
          >
            <div className="relative">
              <Icon className="w-5 h-5" />
              {tab.badge && (
                <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-orange-500 ring-2 ring-card animate-pulse" />
              )}
            </div>
            <span className="leading-none">{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
})

export const MobileTabBar = memo(function MobileTabBar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { openSheet, open } = useMobileTabBar()
  const { scheduleTab, setScheduleTab } = useScheduleTab()
  const hasPending = usePendingAlerts()

  const isOnRepoSchedules = /^\/repos\/\d+\/schedules$/.test(pathname)
  const isRepoMemories = /^\/repos\/\d+\/memories$/.test(pathname)
  const isMobile = useMobile()
  const isRoot = pathname === '/'
  const isGlobalSchedules = pathname === '/schedules'
  const isRepoDetail = /^\/repos\/\d+$/.test(pathname)
  const isInsideRepo = isRepoDetail || isOnRepoSchedules || isRepoMemories
  const isRepoSession = /^\/repos\/\d+\/sessions\/\w+/.test(pathname)
  const allow = isRoot || isGlobalSchedules || (isInsideRepo && !isRepoSession)

  const repoIdMatch = pathname.match(/^\/repos\/(\d+)/)
  const repoId = repoIdMatch ? repoIdMatch[1] : null

  const tabs = useMemo<TabDef[]>(
    () => (isOnRepoSchedules
      ? buildScheduleTabs(scheduleTab, setScheduleTab)
      : buildGlobalTabs({
          pathname,
          openSheet,
          open,
          navigate,
          hasPending,
          isInsideRepo,
          repoId,
        })),
    [isOnRepoSchedules, scheduleTab, setScheduleTab, pathname, openSheet, open, navigate, hasPending, isInsideRepo, repoId],
  )

  if (!isMobile) return null
  if (!allow) return null

  return <TabBarRow tabs={tabs} />
})
