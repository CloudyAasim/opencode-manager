import type { LucideIcon } from 'lucide-react'
import { Bot, CalendarClock, Folder, FolderGit2, GitCommitHorizontal, LogOut, Plug, Settings, ShieldOff, Sparkles, TerminalSquare } from 'lucide-react'
import { getAssistantPath, isAssistantPath } from '@/lib/navigation'

export interface NavItem {
  key: string
  label: string
  labelKey?: string
  icon: LucideIcon
  to?: string
  dialog?: string
  danger?: boolean
  /** Stays inline in the top bar. Everything else lives under More. */
  primary?: boolean
  /** Owns its own idea of "this is the screen I am on", so no other file
   *  has to guess it from the path. */
  matches?: (pathname: string) => boolean
}

export interface NavModel {
  items: NavItem[]
}

export interface NavModelOptions {
  isAdmin?: boolean
  terminalAllowed?: boolean
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.matches) return item.matches(pathname)
  if (item.to) return pathname === item.to
  return false
}

export function buildNavModel(options: NavModelOptions = {}): NavModel {
  const items: NavItem[] = [
    {
      key: 'projects',
      label: 'Projects',
      labelKey: 'navigation.repos',
      icon: FolderGit2,
      to: '/',
      primary: true,
      matches: (pathname) => pathname === '/',
    },
    {
      key: 'assistant',
      label: 'Assistant',
      labelKey: 'navigation.assistant',
      icon: Bot,
      to: getAssistantPath(),
      primary: true,
      matches: (pathname) => isAssistantPath(pathname),
    },
    {
      key: 'files',
      label: 'Files',
      labelKey: 'navigation.files',
      icon: Folder,
      to: '/files',
      primary: true,
    },
    {
      key: 'schedules',
      label: 'Schedules',
      labelKey: 'navigation.schedules',
      icon: CalendarClock,
      to: '/schedules',
      primary: true,
    },
    { key: 'settings', label: 'Settings', labelKey: 'navigation.settings', icon: Settings, to: '/settings' },
  ]

  if (options.isAdmin || options.terminalAllowed) {
    items.push({
      key: 'terminal',
      label: 'Terminal',
      labelKey: 'navigation.terminal',
      icon: TerminalSquare,
      to: '/terminal',
    })
  }

  items.push({ key: 'logout', label: 'Logout', labelKey: 'navigation.logout', icon: LogOut })

  return { items }
}

export function buildProjectToolItems(pathname: string): NavItem[] {
  const match = /^\/repos\/(\d+)(?:\/(?:sessions\/[^/]+|assistant))?$/.exec(pathname)
  const isAssistant = pathname.startsWith('/assistant')
  if (!match && !isAssistant) return []

  const repoId = match?.[1] ?? '0'
  return [
    { key: 'mcp', label: 'MCP', labelKey: 'navigation.mcp', icon: Plug, dialog: 'mcp' },
    { key: 'skills', label: 'Skills', labelKey: 'navigation.skills', icon: Sparkles, dialog: 'skills' },
    { key: 'source-control', label: 'Source Control', labelKey: 'navigation.sourceControl', icon: GitCommitHorizontal, dialog: 'sourceControl' },
    { key: 'schedules', label: 'Schedules', labelKey: 'navigation.schedules', icon: CalendarClock, to: `/repos/${repoId}/schedules` },
    { key: 'reset-permissions', label: 'Reset Permissions', labelKey: 'navigation.resetPermissions', icon: ShieldOff, dialog: 'resetPermissions', danger: true },
  ]
}

export function buildMoreItems(pathname: string, options: NavModelOptions = {}): NavItem[] {
  const tools = buildProjectToolItems(pathname)
  // Inside a project the repo's Schedules is the one that matters. Showing the
  // global one next to it produced two rows both reading "Schedules".
  const insideProject = tools.some((item) => item.key === 'schedules')
  const globalItems = buildNavModel(options).items.filter(
    (item) => !(insideProject && item.key === 'schedules'),
  )
  return [...tools, ...globalItems]
}
