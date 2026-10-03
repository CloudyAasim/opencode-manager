import { useLocation, useNavigate } from 'react-router-dom'
import { Menu, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { MEDIA } from './breakpoints'
import { useMobileSheets } from '@/hooks/useMobileSheets'
import { useAuth } from '@/hooks/useAuth'
import { useTerminalAllowed } from '@/hooks/useTerminalAllowed'
import { useUrlParams } from '@/hooks/useUrlParams'
import {
  buildNavModel,
  buildProjectToolItems,
  isNavItemActive,
} from '@/framework/navigation/navModel'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { RepoSwitcher } from './RepoSwitcher'

// The one place navigation happens. It used to be three: a left rail, a bottom
// bar, and a drawer, each with its own copy of the item list and its own idea
// of what "current" means. The bar and the rail are both gone; what is left
// is this strip, which lays the same model out inline on a wide screen and
// behind one button on a phone.
export function TopBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useI18n()
  // 768px 摆不下标题、仓库切换器和带文字的入口，1024px 才摊得开四个；
  // 六个入口要到 spacious 这一档才排得下。窄于摊得开的那一档就收成一颗
  // 按钮，别让标签一个个截成 'Assis…'。
  const spreadOut = useMediaQuery(MEDIA.spaciousUp)
  const { user, logout } = useAuth()
  const terminalAllowed = useTerminalAllowed()
  const { updateParams } = useUrlParams()
  const { open } = useMobileSheets()

  const { items } = buildNavModel({ isAdmin: user?.role === 'admin', terminalAllowed })
  const primary = items.filter((item) => item.primary)
  const overflow = items.filter((item) => !item.primary)

  const go = (item: (typeof items)[number]) => {
    if (item.to) {
      navigate(item.to)
      return
    }
    if (item.dialog) {
      updateParams((p) => {
        p.set('dialog', item.dialog!)
        p.delete('mobileTab')
      }, 'push')
      return
    }
    if (item.key === 'logout') logout()
  }

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
      <span className="shrink-0 text-sm font-semibold tracking-tight">OpenCode Manager</span>
      <RepoSwitcher />

      <div className="flex min-w-0 flex-1 items-center gap-0.5">
        {spreadOut &&
          primary.map((item) => {
            const active = isNavItemActive(item, location.pathname)
            return (
              <button
                key={item.key}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => go(item)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors',
                  active
                    ? 'bg-accent font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
              >
                <item.icon className="size-4 shrink-0" />
                <span className="truncate">{item.labelKey ? t(item.labelKey) : item.label}</span>
              </button>
            )
          })}
      </div>

      {spreadOut ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 gap-1 px-2 text-muted-foreground"
              aria-label={t('navigation.more')}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-96 w-72 overflow-y-auto">
            {[...buildProjectToolItems(location.pathname), ...overflow].map((item) => (
              <DropdownMenuItem
                key={item.key}
                onSelect={() => go(item)}
                className={item.danger ? 'text-destructive focus:text-destructive' : undefined}
              >
                <item.icon className="size-4 shrink-0" />
                {item.labelKey ? t(item.labelKey) : item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('navigation.more')}
          className="h-8 w-8 shrink-0 p-0"
          onClick={() => open('more')}
        >
          <Menu className="size-4" />
        </Button>
      )}
    </header>
  )
}
