import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, GitBranch, GitCommitHorizontal } from 'lucide-react'
import { fetchGitLog, fetchGitStatus } from '@/api/git'
import { useI18n } from '@/lib/i18n'

export interface ProjectInfoPanelProps {
  repoId: number
  name: string
  directory?: string
  branch?: string
}

export function ProjectInfoPanel({ repoId, name, directory, branch }: ProjectInfoPanelProps) {
  const { t } = useI18n()
  const gitEnabled = repoId > 0

  const { data: status } = useQuery({
    queryKey: ['git', 'status', repoId],
    queryFn: () => fetchGitStatus(repoId),
    enabled: gitEnabled,
    staleTime: 15_000,
    retry: false,
  })

  const { data: log } = useQuery({
    queryKey: ['git', 'log', repoId],
    queryFn: () => fetchGitLog(repoId, 5),
    enabled: gitEnabled,
    staleTime: 30_000,
    retry: false,
  })

  const commits = log?.commits ?? []
  const changeCount = status?.files.length ?? 0
  const branchLabel = status?.branch || branch || 'main'

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4 text-sm">
      <div>
        <div className="text-xs text-muted-foreground">{t('navigation.repo')}</div>
        <div className="font-medium">{name}</div>
      </div>

      <div>
        <div className="text-xs text-muted-foreground">{t('repo.info.directory')}</div>
        <div className="break-all font-mono text-xs">{directory ?? '-'}</div>
      </div>

      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-muted-foreground" />
        <span className="font-mono text-xs">{branchLabel || '—'}</span>
        {status && (status.ahead > 0 || status.behind > 0) ? (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {status.ahead > 0 ? (
              <span className="flex items-center gap-0.5"><ArrowUp className="h-3 w-3" />{status.ahead}</span>
            ) : null}
            {status.behind > 0 ? (
              <span className="flex items-center gap-0.5"><ArrowDown className="h-3 w-3" />{status.behind}</span>
            ) : null}
          </span>
        ) : null}
      </div>

      {gitEnabled ? (
        <div>
          <div className="text-xs text-muted-foreground">{t('repo.info.changes')}</div>
          <div className="font-medium">{changeCount}</div>
        </div>
      ) : null}

      {gitEnabled ? (
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <GitCommitHorizontal className="h-3.5 w-3.5" />
            {t('repo.info.recentCommits')}
          </div>
          {commits.length === 0 ? (
            <div className="text-xs text-muted-foreground">{t('repo.info.noCommits')}</div>
          ) : (
            <ul className="space-y-1.5">
              {commits.map((commit) => (
                <li key={commit.hash} className="rounded border border-border p-2">
                  <div className="truncate">{commit.message.split('\n')[0]}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{commit.hash.slice(0, 7)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
