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
import { buildGlobalMoreItems, buildProjectToolItems, type NavItem } from '@/framework/navigation/navModel'
import { useSwipeBack } from '@/hooks/useMobile'
import { getRepoDisplayName } from '@/lib/utils'
import { getPathWithReturnTo, isAssistantPath } from '@/lib/navigation'
import { useI18n } from '@/lib/i18n'

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
    <SideDrawer isOpen={isOpen} onClose={onClose} side="right" ariaLabel={t('navigation.more')} widthClass="w-screen sm:w-[min(90vw,420px)]">
      <div ref={swipeRef} className="flex flex-col flex-1 min-h-0">
        <div className="flex flex-col flex-shrink-0 border-b border-border bg-background px-4 py-1.5">
          <div className="flex items-center justify-between gap-3 mb-2">
            {versionLabel && (
              <span className="truncate text-xs leading-tight text-muted-foreground">{versionLabel}</span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-sm p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t('navigation.close')}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {scope === 'project' && (repoDisplayName || currentBranch) && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {repoDisplayName && (
                <span className="font-medium text-primary">{repoDisplayName}</span>
              )}

              {currentBranch && (
                <>
                  <GitBranch className="h-3.5 w-3.5" />
                  <span>{currentBranch}</span>
                </>
              )}
            </div>
          )}
        </div>
        <SideDrawerContent className="flex flex-col gap-1">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
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
              className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent transition-colors text-left w-full"
            >
              <item.icon className="w-5 h-5 text-muted-foreground" />
              <span className="font-medium text-foreground">{item.labelKey ? t(item.labelKey) : item.label}</span>
            </button>
          ))}
        </SideDrawerContent>
      </div>
    </SideDrawer>
  )
}
