import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, FolderGit2 } from 'lucide-react'
import { listRepos } from '@/api/repos'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/lib/i18n'

function repoIdFromPath(pathname: string): number | null {
  const match = /^\/repos\/(\d+)/.exec(pathname)
  return match?.[1] ? Number(match[1]) : null
}

export function RepoSwitcher() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { data: repos } = useQuery({ queryKey: ['repos'], queryFn: listRepos })

  const activeId = repoIdFromPath(pathname)
  const active = repos?.find((repo) => repo.id === activeId)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-64 gap-2 px-2">
          <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{active ? active.name || active.localPath : t('shell.repo.all')}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 w-72 overflow-y-auto">
        <DropdownMenuItem onSelect={() => navigate('/')}>
          {t('shell.repo.all')}
        </DropdownMenuItem>
        {(repos ?? []).map((repo) => (
          <DropdownMenuItem key={repo.id} onSelect={() => navigate(`/repos/${repo.id}`)}>
            <span className="truncate">{repo.name || repo.localPath}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
