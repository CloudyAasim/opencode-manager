import { useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { getRepo } from '@/api/repos'
import { useSessionsAcrossDirectories } from '@/hooks/useOpenCode'
import { useCreateSession } from '@/hooks/useOpenCode'
import { OPENCODE_API_ENDPOINT } from '@/config'
import { projectSessionPath } from '@/lib/project-session-path'
import { useI18n } from '@/lib/i18n'
import { useWorktreeTab } from '@/hooks/useWorktreeTab'

export function RepoDetail() {
  const { t } = useI18n()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const repoId = Number(id) || 0
  const { activeTab } = useWorktreeTab()

  const { data: repo, isLoading: repoLoading } = useQuery({
    queryKey: ['repo', repoId],
    queryFn: () => getRepo(repoId),
    enabled: id !== undefined && id !== '',
  })

  const opcodeUrl = OPENCODE_API_ENDPOINT
  const { data: existingSessions } = useSessionsAcrossDirectories(
    opcodeUrl,
    repo?.fullPath ? [repo.fullPath] : [],
    { limit: 25 },
  )
  const latestSessionId = existingSessions[0]?.id

  const createSessionMutation = useCreateSession(opcodeUrl, repo?.fullPath)
  const createSessionRef = useRef(createSessionMutation)
  createSessionRef.current = createSessionMutation

  useEffect(() => {
    if (repoLoading) return
    if (latestSessionId) {
      navigate(projectSessionPath(repoId, latestSessionId, activeTab), { replace: true })
      return
    }
    if (repo && repo.cloneStatus === 'ready' && !createSessionRef.current.isPending) {
      createSessionRef.current.mutate({}, {
        onSuccess: (session) => {
          navigate(projectSessionPath(repoId, session.id, activeTab), { replace: true })
        },
      })
    }
  }, [repoLoading, latestSessionId, repo, repoId, activeTab, navigate])

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" aria-label={t('repo.loading')} />
    </div>
  )
}
