import { useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { getRepo } from '@/api/repos'
import { useSessionsAcrossDirectories, useCreateSession } from '@/hooks/useOpenCode'
import { OPENCODE_API_ENDPOINT } from '@/config'
import { projectSessionPath } from '@/lib/project-session-path'
import { useI18n } from '@/lib/i18n'
import { useWorktreeTab } from '@/hooks/useWorktreeTab'
import { SessionRouteFallback } from '@/components/session/SessionRouteFallback'

export function RepoDetail() {
  const { t } = useI18n()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const repoId = Number(id) || 0
  const { activeTab } = useWorktreeTab()

  const { data: repo, isLoading: repoLoading, error: repoError } = useQuery({
    queryKey: ['repo', repoId],
    queryFn: () => getRepo(repoId),
    enabled: id !== undefined && id !== '',
    retry: (failureCount) => failureCount < 2,
  })

  const opcodeUrl = OPENCODE_API_ENDPOINT
  const { data: existingSessions, isFetched: sessionsFetched } = useSessionsAcrossDirectories(
    opcodeUrl,
    repo?.fullPath ? [repo.fullPath] : [],
    { limit: 25 },
  )
  const latestSessionId = existingSessions[0]?.id

  const createSessionMutation = useCreateSession(opcodeUrl, repo?.fullPath)
  const createSessionRef = useRef(createSessionMutation)
  createSessionRef.current = createSessionMutation

  useEffect(() => {
    if (repoLoading || repoError) return
    if (!repo?.fullPath) return
    if (!sessionsFetched) return
    if (latestSessionId) {
      navigate(projectSessionPath(repoId, latestSessionId, activeTab), { replace: true })
      return
    }
    if (repo.cloneStatus === 'ready' && !createSessionRef.current.isPending) {
      createSessionRef.current.mutate({}, {
        onSuccess: (session) => {
          if (!session?.id) return
          navigate(projectSessionPath(repoId, session.id, activeTab), { replace: true })
        },
      })
    }
  }, [repoLoading, repoError, sessionsFetched, latestSessionId, repo, repoId, activeTab, navigate])

  if (repoError) {
    return (
      <SessionRouteFallback
        message={t('session.route.repositoryNotFound')}
        backTo="/"
        backLabel={t('session.route.backToRepositories')}
      />
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" aria-label={t('repo.loading')} />
    </div>
  )
}
