import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listRepos } from '@/api/repos'
import { useAuth } from '@/hooks/useAuth'
import { useTerminalAllowed } from '@/hooks/useTerminalAllowed'
import { useRegisterCommands } from './commandRegistry'
import type { AppCommand } from './types'

export function BuiltinCommands() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const terminalAllowed = useTerminalAllowed()
  const { data: repos } = useQuery({ queryKey: ['repos'], queryFn: listRepos })

  const terminalVisible = Boolean(user?.role === 'admin' || terminalAllowed)

  const commands = useMemo<AppCommand[]>(() => {
    const go = (to: string) => () => navigate(to)
    const base: AppCommand[] = [
      { id: 'nav.repos', group: 'navigate', labelKey: 'navigation.repos', keywords: ['projects', 'home'], run: go('/') },
      { id: 'nav.files', group: 'navigate', labelKey: 'navigation.files', keywords: ['browse'], run: go('/files') },
      { id: 'nav.schedules', group: 'navigate', labelKey: 'navigation.schedules', keywords: ['cron', 'jobs'], run: go('/schedules') },
      { id: 'nav.settings', group: 'navigate', labelKey: 'navigation.settings', keywords: ['preferences'], run: go('/settings') },
    ]
    if (terminalVisible) {
      base.push({ id: 'nav.terminal', group: 'navigate', labelKey: 'navigation.terminal', keywords: ['shell', 'console'], run: go('/terminal') })
    }
    for (const repo of repos ?? []) {
      const name = repo.name || repo.localPath
      base.push({
        id: `repo.${repo.id}`,
        group: 'repo',
        labelKey: 'shell.commands.repoItem',
        label: name,
        keywords: [name, repo.localPath],
        run: go(`/repos/${repo.id}`),
      })
    }
    return base
  }, [navigate, terminalVisible, repos])

  useRegisterCommands(commands)
  return null
}
