import { useLocation, useNavigate } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { useDesktop } from '@/hooks/useDesktop'
import { useMobileTabBar } from '@/hooks/useMobileTabBar'
import { useAuth } from '@/hooks/useAuth'
import { useTerminalAllowed } from '@/hooks/useTerminalAllowed'
import { useUrlParams } from '@/hooks/useUrlParams'
import { buildNavModel, isNavItemActive } from '@/features/navigation/moreDrawerItems'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

// The phone answer to the desktop rail, from the same list. Items marked
// primary live here; everything else - terminal, settings, the per-repo tools -
// is one tap away in the overflow, which is where infrequent things belong.
//
// Nothing here parses the path to decide whether to show itself. A new route
// cannot make the bar disappear, because the bar is always the same five
// things; only the highlight moves, and each item owns that.
export function MobileTabBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useI18n()
  const { open, openSheet } = useMobileTabBar()
  const { user } = useAuth()
  const terminalAllowed = useTerminalAllowed()
  const { updateParams } = useUrlParams()
  const isDesktop = useDesktop()

  if (isDesktop) return null

  const { items } = buildNavModel({ isAdmin: user?.role === 'admin', terminalAllowed })
  const primary = items.filter((item) => item.primary)

  return (
    <nav
      aria-label={t('navigation.menu')}
      className="fixed bottom-0 inset-x-0 z-40 flex border-t border-border bg-card/95 pb-safe backdrop-blur"
    >
      {primary.map((item) => {
        const active = isNavItemActive(item, location.pathname)
        return (
          <button
            key={item.key}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => {
              if (!item.to) return
              if (openSheet) updateParams((p) => p.delete('mobileTab'), 'replace')
              navigate(item.to)
            }}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] transition-colors',
              active ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <item.icon className="h-5 w-5" />
            {item.labelKey ? t(item.labelKey) : item.label}
          </button>
        )
      })}

      <button
        type="button"
        aria-expanded={openSheet === 'more'}
        onClick={() => open('more')}
        className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] text-muted-foreground transition-colors"
      >
        <Menu className="h-5 w-5" />
        {t('navigation.more')}
      </button>
    </nav>
  )
}
