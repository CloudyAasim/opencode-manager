import type { LucideIcon } from 'lucide-react'
import { Plug, Sparkles, ShieldOff, CalendarClock, GitCommitHorizontal, Code2, Settings, LogOut, Plus, Bot, Folder, Clock, SquarePlus, Home, TerminalSquare } from 'lucide-react'
import { getAssistantPath, isAssistantPath } from '@/lib/navigation'
import type { SidebarActionKey } from '@/hooks/useSidebarAction'

export interface MoreDrawerItem {
  key: string
  label: string
  labelKey?: string
  icon: LucideIcon
  to?: string
  dialog?: string
  danger?: boolean
}

export interface NavPrimaryCta {
  key: string
  label: string
  labelKey?: string
  icon: LucideIcon
  to?: string
  onSelect?: SidebarActionKey
  variant?: 'primary' | 'secondary'
}

export interface NavModel {
  primary: NavPrimaryCta[]
  items: MoreDrawerItem[]
}

export interface NavModelOptions {
  isAdmin?: boolean
  terminalAllowed?: boolean
}

function getAssistantNavItem(_pathname: string, variant: NavPrimaryCta['variant'] = 'secondary'): NavPrimaryCta {
  return {
    key: 'assistant',
    label: 'Assistant',
    labelKey: 'navigation.assistant',
    icon: Bot,
    to: getAssistantPath(),
    variant,
  }
}

function getHomeItem(): MoreDrawerItem {
  return { key: 'home', label: 'Home', labelKey: 'navigation.home', icon: Home, to: '/' }
}

function getBaseItems(options: NavModelOptions): MoreDrawerItem[] {
  const showTerminal = options.isAdmin || options.terminalAllowed
  return [
    ...(showTerminal
      ? [{ key: 'terminal', label: 'Terminal', labelKey: 'navigation.terminal', icon: TerminalSquare, to: '/terminal' }]
      : []),
    { key: 'settings', label: 'Settings', labelKey: 'navigation.settings', icon: Settings },
    { key: 'logout', label: 'Logout', labelKey: 'navigation.logout', icon: LogOut },
  ]
}

function buildRouteNavModel(pathname: string, options: NavModelOptions): NavModel {
  const baseItems = getBaseItems(options)

  const repoDetailMatch = /^\/repos\/(\d+)$/.exec(pathname)
  if (repoDetailMatch) {
    const id = repoDetailMatch[1]
    const items: MoreDrawerItem[] = [
      { key: 'files', label: 'Files', labelKey: 'navigation.files', icon: Folder, dialog: 'files' },
      { key: 'mcp', label: 'MCP', labelKey: 'navigation.mcp', icon: Plug, dialog: 'mcp' },
      { key: 'skills', label: 'Skills', labelKey: 'navigation.skills', icon: Sparkles, dialog: 'skills' },
      { key: 'reset-permissions', label: 'Reset Permissions', labelKey: 'navigation.resetPermissions', icon: ShieldOff, dialog: 'resetPermissions', danger: true },
      { key: 'schedules', label: 'Schedules', labelKey: 'navigation.schedules', icon: CalendarClock, to: `/repos/${id}/schedules` },
      { key: 'source-control', label: 'Source Control', labelKey: 'navigation.sourceControl', icon: GitCommitHorizontal, dialog: 'sourceControl' },
      ...baseItems,
    ]

    return {
      primary: [
        { key: 'new-session', label: 'New Session', labelKey: 'navigation.newSession', icon: SquarePlus, onSelect: 'new-session', variant: 'primary' },
        getAssistantNavItem(pathname),
      ],
      items,
    }
  }

  const sessionDetailMatch = /^\/repos\/(\d+)\/sessions\/[^/]+$/.exec(pathname)
  if (sessionDetailMatch) {
    const items: MoreDrawerItem[] = [
      { key: 'files', label: 'Files', labelKey: 'navigation.files', icon: Folder, dialog: 'files' },
      { key: 'mcp', label: 'MCP', labelKey: 'navigation.mcp', icon: Plug, dialog: 'mcp' },
      { key: 'skills', label: 'Skills', labelKey: 'navigation.skills', icon: Sparkles, dialog: 'skills' },
      { key: 'lsp', label: 'LSP', labelKey: 'navigation.lsp', icon: Code2, dialog: 'lsp' },
      { key: 'reset-permissions', label: 'Reset Permissions', labelKey: 'navigation.resetPermissions', icon: ShieldOff, dialog: 'resetPermissions', danger: true },
      { key: 'schedules', label: 'Schedules', labelKey: 'navigation.schedules', icon: CalendarClock, to: `/repos/${sessionDetailMatch[1]}/schedules` },
      { key: 'source-control', label: 'Source Control', labelKey: 'navigation.sourceControl', icon: GitCommitHorizontal, dialog: 'sourceControl' },
      ...baseItems,
    ]

    return {
      primary: [
        { key: 'new-session', label: 'New Session', labelKey: 'navigation.newSession', icon: SquarePlus, onSelect: 'new-session', variant: 'primary' },
        getAssistantNavItem(pathname),
      ],
      items,
    }
  }

  if (isAssistantPath(pathname)) {
    const items: MoreDrawerItem[] = [
      { key: 'files', label: 'Files', labelKey: 'navigation.files', icon: Folder, dialog: 'files' },
      { key: 'mcp', label: 'MCP', labelKey: 'navigation.mcp', icon: Plug, dialog: 'mcp' },
      { key: 'skills', label: 'Skills', labelKey: 'navigation.skills', icon: Sparkles, dialog: 'skills' },
      { key: 'reset-permissions', label: 'Reset Permissions', labelKey: 'navigation.resetPermissions', icon: ShieldOff, dialog: 'resetPermissions', danger: true },
      { key: 'schedules', label: 'Schedules', labelKey: 'navigation.schedules', icon: CalendarClock, to: '/repos/0/schedules' },
      { key: 'source-control', label: 'Source Control', labelKey: 'navigation.sourceControl', icon: GitCommitHorizontal, dialog: 'sourceControl' },
      ...baseItems,
    ]

    return {
      primary: [
        { key: 'new-session', label: 'New Session', labelKey: 'navigation.newSession', icon: SquarePlus, onSelect: 'new-session', variant: 'primary' },
        getAssistantNavItem(pathname, 'secondary'),
      ],
      items,
    }
  }

  if (pathname === '/schedules' || /^\/repos\/\d+\/schedules$/.test(pathname)) {
    return {
      primary: [
        { key: 'new-schedule', label: 'New Schedule', labelKey: 'navigation.newSchedule', icon: Clock, onSelect: 'new-schedule', variant: 'primary' },
        getAssistantNavItem(pathname),
      ],
      items: baseItems,
    }
  }

  if (pathname === '/') {
    return {
      primary: [
        { key: 'new-repo', label: 'New Repo', labelKey: 'navigation.newRepo', icon: Plus, onSelect: 'new-repo', variant: 'primary' },
        getAssistantNavItem(pathname),
      ],
      items: [
        { key: 'all-schedules', label: 'All Schedules', labelKey: 'navigation.allSchedules', icon: CalendarClock, to: '/schedules' },
        { key: 'files', label: 'Files', labelKey: 'navigation.files', icon: Folder, dialog: 'files' },
        ...baseItems,
      ],
    }
  }

  return {
    primary: [
      getAssistantNavItem(pathname),
    ],
    items: baseItems,
  }
}

export function buildNavModel(pathname: string, options: NavModelOptions = {}): NavModel {
  const { primary, items } = buildRouteNavModel(pathname, options)
  return { primary, items: [getHomeItem(), ...items] }
}

export function buildMoreItems(pathname: string, options: NavModelOptions = {}): MoreDrawerItem[] {
  return buildNavModel(pathname, options).items
}
