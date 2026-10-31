import { useNavigate, useLocation, useParams } from 'react-router-dom'
import { useRef, useEffect } from 'react'
import { X, GitBranch } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useServerHealth } from '@/hooks/useServerHealth'
import { useTerminalAllowed } from '@/hooks/useTerminalAllowed'
import { useUrlParams } from '@/hooks/useUrlParams'
import { useQuery } from '@tanstack/react-query'
import { getRepo } from '@/api/repos'
import { useRefreshOnOpen } from '@/hooks/useRefreshOnOpen'
import { SideDrawer, SideDrawerContent } from '@/components/ui/side-drawer'
import { buildGlobalMoreItems, buildProjectToolItems, isNavItemActive, type NavItem } from '@/framework/navigation/navModel'
import { useSwipeBack } from '@/hooks/useMobile'
import { cn, getRepoDisplayName } from '@/lib/utils'
import { getPathWithReturnTo, isAssistantPath } from '@/lib/navigation'
import { useI18n } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Row } from '@/components/ui/row'

/**
 * Which question this drawer is answering.
 *
 * `global` is the top bar's hamburger and lists where you can go.
 * `project` is the `⋮` on a session page and lists what you can do to the
 * repository you are looking at.
 *
 * They used to be one list built by concatenating both, which on a session page
 * put MCP, Skills, Source Control, Schedules and Reset Permissions inside the
 * global menu next to Projects, Assistant, Settings and Logout. The two buttons
 * said different things, so the drawer behind them should too.
 */
export type MoreDrawerScope = 'global' | 'project'

interface MoreDrawerProps {
  isOpen: boolean
  onClose: () => void
  scope: MoreDrawerScope
}

export function MoreDrawer({ isOpen, onClose, scope }: MoreDrawerProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams<{ id: string }>()
  const repoId = id ? Number(id) : null
  const swipeRef = useRef<HTMLDivElement>(null)
  const { bind } = useSwipeBack(onClose, { enabled: isOpen, suspendsRouteSwipe: true })
  const { searchParams, updateParams } = useUrlParams()
  const { logout, user } = useAuth()
  const { t } = useI18n()
  const { data: health } = useServerHealth()
  const terminalAllowed = useTerminalAllowed()
  const isSessionDetail = /^\/repos\/\d+\/sessions\/[^/]+$/.test(location.pathname)
  const isAssistantRoute = isAssistantPath(location.pathname)
  const isAssistantSession = isSessionDetail && searchParams.get('assistant') === '1'

  useEffect(() => {
    if (isOpen && swipeRef.current) {
      const cleanup = bind(swipeRef.current)
      return cleanup
    }
  }, [isOpen, bind])

  const { data: repo, refetch: refetchRepo } = useQuery({
    queryKey: ['repo', repoId],
    queryFn: () => repoId ? getRepo(repoId) : null,
    enabled: !!repoId,
  })

  useRefreshOnOpen(isOpen && repoId != null, () => { void refetchRepo() })

  const currentBranch = repo?.currentBranch || repo?.branch
  const repoDisplayName = isAssistantRoute || isAssistantSession
    ? t('navigation.assistant')
    : repo ? getRepoDisplayName(repo) : null

  const handleSettingsClick = () => {
    updateParams((p) => {
      p.delete('mobileTab')
      p.set('settings', 'open')
      p.set('settingsTab', 'account')
    }, 'replace')
  }

  const handleLogoutClick = async () => {
    try {
      await logout()
    } finally {
      onClose()
    }
  }

  const handleItemClick = (item: NavItem) => {
    if (item.to) {
      const to = item.key === 'schedules'
        ? getPathWithReturnTo(item.to, `${location.pathname}${location.search}`)
        : item.to
      navigate(to)
    } else if (item.dialog) {
      updateParams((p) => {
        p.set('dialog', item.dialog!)
        p.delete('mobileTab')
      }, 'replace')
    }
  }

  const items = scope === 'project'
    ? buildProjectToolItems(location.pathname)
    : buildGlobalMoreItems({ isAdmin: user?.role === 'admin', terminalAllowed })

  const opencodeVersion = health?.opencodeVersion
  const managerVersion = health?.opencodeManagerVersion
  const versionLabel = [
    opencodeVersion ? `v${opencodeVersion}` : null,
    managerVersion ? t('navigation.managerVersion', { version: managerVersion }) : null,
  ].filter(Boolean).join(' · ')

  return (
    <SideDrawer
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={t('navigation.more')}
      width="lg"
    >
      <div ref={swipeRef} className="flex flex-col flex-1 min-h-0">
        {/* The head of the drawer says where you are.
         *
         * It used to be a band with a rule under it, holding a version string
         * on the left and a close button that jumped to the right when the
         * version happened to be missing - which is most of the time, because
         * the version only shows up once the health check answers. So the
         * drawer opened with an empty strip and a lonely X in the corner of
         * it.
         *
         * Now it is a title and a close button, the same way the desktop
         * dialogs are, and the version has moved down to the foot of the
         * drawer where it is information rather than a heading.
         */}
        <div className="flex shrink-0 items-start gap-3 px-4 pb-1 pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold leading-none text-foreground">
              {scope === 'project' && repoDisplayName ? repoDisplayName : t('navigation.more')}
            </h2>
            {scope === 'project' && currentBranch && (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <GitBranch className="size-3.5 shrink-0" />
                <span className="truncate">{currentBranch}</span>
              </div>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className="-mr-1 shrink-0 text-muted-foreground"
            aria-label={t('navigation.close')}
          >
            <X className="size-5" />
          </Button>
        </div>
        <SideDrawerContent className="flex flex-col gap-1 pt-2">
          {items.map((item) => {
            // The drawer is the phone's face of the same navigation, so it
            // says where you are the same way the top bar does - and it asks
            // the same model, so the two cannot disagree.
            const current = isNavItemActive(item, location.pathname)
            return (
              <Row
                key={item.key}
                type="button"
                size="touch"
                onClick={() => {
                  if (item.to) {
                    handleItemClick(item)
                  } else if (item.key === 'settings') {
                    handleSettingsClick()
                  } else if (item.key === 'logout') {
                    handleLogoutClick()
                  } else {
                    handleItemClick(item)
                  }
                }}
                aria-current={current ? 'page' : undefined}
                selected={current}
                className="items-center gap-3 p-3"
              >
                <item.icon className={cn('size-5 shrink-0', current ? 'text-foreground' : 'text-muted-foreground')} />
                <span className="font-medium text-foreground">{item.labelKey ? t(item.labelKey) : item.label}</span>
              </Row>
            )
          })}
        </SideDrawerContent>
        {versionLabel && (
          <div className="shrink-0 px-4 pb-4 pt-2 text-xs leading-tight text-muted-foreground">
            {versionLabel}
          </div>
        )}
      </div>
    </SideDrawer>
  )
}
