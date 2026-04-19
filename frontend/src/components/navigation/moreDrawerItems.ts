import type { LucideIcon } from 'lucide-react'
import { FolderOpen, Brain, Plug, Sparkles, ShieldOff, CalendarClock, GitCommitHorizontal, Code2, Settings, LogOut } from 'lucide-react'

export interface MoreDrawerItem {
  key: string
  label: string
  icon: LucideIcon
  to?: string
  dialog?: string
  danger?: boolean
}

export interface BuildMoreItemsOptions {
  memoryPluginEnabled?: boolean
}

export function buildMoreItems(pathname: string, options: BuildMoreItemsOptions = {}): MoreDrawerItem[] {
  const { memoryPluginEnabled = false } = options
  const baseItems: MoreDrawerItem[] = [
    { key: 'settings', label: 'Settings', icon: Settings },
    { key: 'logout', label: 'Logout', icon: LogOut },
  ]

  // Root path - no route-specific items
  if (pathname === '/') {
    return baseItems
  }

  // RepoDetail: /repos/:id
  const repoDetailMatch = /^\/repos\/(\d+)$/.exec(pathname)
  if (repoDetailMatch) {
    const id = repoDetailMatch[1]
    return [
      { key: 'files', label: 'Files', icon: FolderOpen, dialog: 'files' },
      ...(memoryPluginEnabled
        ? [{ key: 'memory', label: 'Memory', icon: Brain, to: `/repos/${id}/memories` }]
        : []),
      { key: 'mcp', label: 'MCP', icon: Plug, dialog: 'mcp' },
      { key: 'skills', label: 'Skills', icon: Sparkles, dialog: 'skills' },
      { key: 'reset-permissions', label: 'Reset Permissions', icon: ShieldOff, dialog: 'resetPermissions', danger: true },
      { key: 'schedules', label: 'Schedules', icon: CalendarClock, to: `/repos/${id}/schedules` },
      { key: 'source-control', label: 'Source Control', icon: GitCommitHorizontal, dialog: 'sourceControl' },
      ...baseItems,
    ]
  }

  // SessionDetail: /repos/:id/sessions/:sid
  const sessionDetailMatch = /^\/repos\/(\d+)\/sessions\/[^/]+$/.exec(pathname)
  if (sessionDetailMatch) {
    const id = sessionDetailMatch[1]
    return [
      { key: 'files', label: 'Files', icon: FolderOpen, dialog: 'files' },
      ...(memoryPluginEnabled
        ? [{ key: 'memory', label: 'Memory', icon: Brain, to: `/repos/${id}/memories` }]
        : []),
      { key: 'mcp', label: 'MCP', icon: Plug, dialog: 'mcp' },
      { key: 'skills', label: 'Skills', icon: Sparkles, dialog: 'skills' },
      { key: 'lsp', label: 'LSP', icon: Code2, dialog: 'lsp' },
      { key: 'reset-permissions', label: 'Reset Permissions', icon: ShieldOff, dialog: 'resetPermissions', danger: true },
      { key: 'source-control', label: 'Source Control', icon: GitCommitHorizontal, dialog: 'sourceControl' },
      ...baseItems,
    ]
  }

  // Memories: /repos/:id/memories - no extra items
  if (/^\/repos\/\d+\/memories$/.test(pathname)) {
    return baseItems
  }

  // Schedules routes - no extra items
  if (pathname === '/schedules' || /^\/repos\/\d+\/schedules$/.test(pathname)) {
    return baseItems
  }

  // Unknown path - return base items only
  return baseItems
}
