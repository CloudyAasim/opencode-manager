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
  // Everything that is a place stays inline while the bar has room. Terminal
  // used to be appended after Settings, so it was the one entry that fell into
  // the overflow menu on a wide screen even with a six-item bar fitting easily.
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
      matches: (pathname) => pathname === '/files',
    },
  ]

  if (options.isAdmin || options.terminalAllowed) {
    items.push({
      key: 'terminal',
      label: 'Terminal',
      labelKey: 'navigation.terminal',
      icon: TerminalSquare,
      to: '/terminal',
      primary: true,
      matches: (pathname) => pathname === '/terminal',
    })
  }

  items.push(
    {
      key: 'schedules',
      label: 'Schedules',
      labelKey: 'navigation.schedules',
      icon: CalendarClock,
      to: '/schedules',
      primary: true,
      // A project's Schedules is the same place as the global one, so entering
      // it has to keep the entry lit instead of dropping the highlight.
      matches: (pathname) => pathname === '/schedules' || /^\/repos\/[^/]+\/schedules$/.test(pathname),
    },
    {
      key: 'settings',
      label: 'Settings',
      labelKey: 'navigation.settings',
      icon: Settings,
      to: '/settings',
      primary: true,
      matches: (pathname) => pathname === '/settings',
    },
    { key: 'logout', label: 'Logout', labelKey: 'navigation.logout', icon: LogOut },
  )

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

/**
 * The two drawers a phone can open, kept apart on purpose.
 *
 * The hamburger in the top bar and the `⋮` on a session page are different
 * buttons asking different questions - "where do I go" and "what can I do to
 * this project" - and they used to open one drawer that answered both. On a
 * session page that meant MCP, Skills, Source Control, Schedules and Reset
 * Permissions stacked up inside the global navigation menu, five rows of
 * project furniture in a list that also held Projects, Assistant, Settings and
 * Logout.
 *
 * So the list is now chosen by intent instead of concatenated. Nothing is lost:
 * `buildProjectToolItems` is still reachable from the page you are on, one tap
 * away on the `⋮` that was already there and already said "more" about *this
 * session* rather than about the app.
 */
export function buildGlobalMoreItems(options: NavModelOptions = {}): NavItem[] {
  return buildNavModel(options).items
}
