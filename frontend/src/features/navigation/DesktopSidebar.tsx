import { useLocation, useNavigate } from 'react-router-dom'
import { useDesktop } from '@/hooks/useDesktop'
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed'
import { useAuth } from '@/hooks/useAuth'
import { useTerminalAllowed } from '@/hooks/useTerminalAllowed'
import { useUrlParams } from '@/hooks/useUrlParams'
import { buildNavModel, isNavItemActive, type MoreDrawerItem } from '@/features/navigation/moreDrawerItems'
import { useI18n } from '@/lib/i18n'
import { Sidebar, SidebarItem } from '@/components/ui/sidebar'

export function DesktopSidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { updateParams } = useUrlParams()
  const { t } = useI18n()
  const [collapsed, toggle] = useSidebarCollapsed()
  const { isAuthenticated, isLoading, logout, user } = useAuth()
  const terminalAllowed = useTerminalAllowed()

  const isDesktop = useDesktop()

  if (isLoading || !isAuthenticated) {
    return null
  }

  if (!isDesktop) {
    return null
  }

  const { items } = buildNavModel({ isAdmin: user?.role === 'admin', terminalAllowed })

  const isItemActive = (item: MoreDrawerItem) => isNavItemActive(item, location.pathname)

  const handleItemClick = (item: MoreDrawerItem) => {
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
    if (item.key === 'logout') {
      logout()
    }
  }

  return (
    <Sidebar collapsed={collapsed} onToggle={toggle} className="mt-2">
      <div className="flex flex-col gap-1 p-2 pt-0">
        {items.map((item) => (
          <SidebarItem
            key={item.key}
            icon={item.icon}
            label={item.labelKey ? t(item.labelKey) : item.label}
            collapsed={collapsed}
            active={isItemActive(item)}
            danger={item.danger}
            onClick={() => handleItemClick(item)}
          />
        ))}
      </div>
    </Sidebar>
  )
}
