import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useServerHealth } from '@/hooks/useServerHealth'
import { useMemoryPluginStatus } from '@/hooks/useMemoryPluginStatus'
import { SideDrawer, SideDrawerHeader, SideDrawerContent } from '@/components/ui/side-drawer'
import { buildMoreItems } from './moreDrawerItems'

interface MoreDrawerProps {
  isOpen: boolean
  onClose: () => void
}

export function MoreDrawer({ isOpen, onClose }: MoreDrawerProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { logout } = useAuth()
  const { data: health } = useServerHealth()
  const { memoryPluginEnabled } = useMemoryPluginStatus()

  const handleSettingsClick = () => {
    const newParams = new URLSearchParams(location.search)
    newParams.delete('mobileTab')
    newParams.set('settings', 'open')
    newParams.set('tab', 'account')
    navigate({ search: newParams.toString() }, { replace: true })
  }

  const handleLogoutClick = async () => {
    try {
      await logout()
    } finally {
      onClose()
    }
  }

  const handleItemClick = (item: ReturnType<typeof buildMoreItems>[0]) => {
    if (item.to) {
      navigate(item.to)
    } else if (item.dialog) {
      const newParams = new URLSearchParams(location.search)
      newParams.set('dialog', item.dialog)
      newParams.delete('mobileTab')
      navigate({ search: newParams.toString() }, { replace: true })
    }
  }

  const items = buildMoreItems(location.pathname, { memoryPluginEnabled })

  const opencodeVersion = health?.opencodeVersion
  const managerVersion = health?.opencodeManagerVersion

  return (
    <SideDrawer isOpen={isOpen} onClose={onClose} side="right" ariaLabel="More">
      <SideDrawerHeader
        title={opencodeVersion ? `OpenCode v${opencodeVersion}` : 'OpenCode'}
        onClose={onClose}
        meta={
          managerVersion ? (
            <div className="text-xs text-muted-foreground">Manager v{managerVersion}</div>
          ) : null
        }
      />
      <SideDrawerContent className="flex flex-col gap-1">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              if (item.key === 'settings') {
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
            <span className="font-medium text-foreground">{item.label}</span>
          </button>
        ))}
      </SideDrawerContent>
    </SideDrawer>
  )
}
