import type { LucideIcon } from 'lucide-react'
import { Bot, CalendarClock, Folder, FolderGit2, GitCommitHorizontal, LogOut, Plug, Settings, ShieldOff, Sparkles, TerminalSquare } from 'lucide-react'
import { getAssistantPath } from '@/lib/navigation'

export interface MoreDrawerItem {
  key: string
  label: string
  labelKey?: string
  icon: LucideIcon
  to?: string
  dialog?: string
  danger?: boolean
}

export interface NavModel {
  items: MoreDrawerItem[]
}

export interface NavModelOptions {
  isAdmin?: boolean
  terminalAllowed?: boolean
}

/**
 * The global rail is intentionally fixed: 项目 / 助手 / 文件 / 终端 / 设置.
 * Project tooling (Files, Source Control, Schedules, MCP, Skills) lives inside a
 * project, not in the global navigation.
 */
export function buildNavModel(options: NavModelOptions = {}): NavModel {
  const showTerminal = Boolean(options.isAdmin || options.terminalAllowed)
  const items: MoreDrawerItem[] = [
    { key: 'projects', label: 'Projects', labelKey: 'navigation.repos', icon: FolderGit2, to: '/' },
    { key: 'assistant', label: 'Assistant', labelKey: 'navigation.assistant', icon: Bot, to: getAssistantPath() },
    { key: 'files', label: 'Files', labelKey: 'navigation.files', icon: Folder, to: '/files' },
  ]

  if (showTerminal) {
    items.push({ key: 'terminal', label: 'Terminal', labelKey: 'navigation.terminal', icon: TerminalSquare, to: '/terminal' })
  }

  items.push(
    { key: 'settings', label: 'Settings', labelKey: 'navigation.settings', icon: Settings },
    { key: 'logout', label: 'Logout', labelKey: 'navigation.logout', icon: LogOut },
  )

  return { items }
}

function projectToolItems(pathname: string): MoreDrawerItem[] {
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

export function buildMoreItems(pathname: string, options: NavModelOptions = {}): MoreDrawerItem[] {
  return [...projectToolItems(pathname), ...buildNavModel(options).items]
}
