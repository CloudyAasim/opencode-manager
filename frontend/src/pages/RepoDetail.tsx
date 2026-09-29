import { useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { getRepo } from '@/api/repos'
import { OPENCODE_API_ENDPOINT } from '@/config'
import { projectSessionPath } from '@/lib/project-session-path'
import { useI18n } from '@/lib/i18n'
import { useWorktreeTab } from '@/hooks/useWorktreeTab'
import { SessionRouteFallback } from '@/components/session/SessionRouteFallback'
import { getSessionListPath } from '@/lib/navigation'

interface SessionListEnvelope {
  data?: Array<{ id?: string }>
}

async function createSession(directory: string): Promise<string | null> {
  const response = await fetch(`${OPENCODE_API_ENDPOINT}/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ directory }),
  })
  if (!response.ok) return null
  const session = (await response.json()) as { id?: string }
  return session.id ?? null
}

export function RepoDetail() {
  const { t } = useI18n()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const repoId = Number(id) || 0
  const { activeTab } = useWorktreeTab()

  const { data: repo, error: repoError } = useQuery({
    queryKey: ['repo', repoId],
    queryFn: () => getRepo(repoId),
    enabled: id !== undefined && id !== '',
    retry: (failureCount) => failureCount < 2,
  })

  const directory = repo?.fullPath
  const contextRef = useRef({ repoId, activeTab, navigate, cloneStatus: repo?.cloneStatus })
  contextRef.current = { repoId, activeTab, navigate, cloneStatus: repo?.cloneStatus }

  useEffect(() => {
    if (!directory) return

    const controller = new AbortController()

    void (async () => {
      let latestSessionId: string | undefined
      try {
        const response = await fetch(
          `${OPENCODE_API_ENDPOINT}/api/session?limit=1&order=desc&directory=${encodeURIComponent(directory)}`,
          { signal: controller.signal, credentials: 'include' },
        )
        if (response.ok) {
          const body = (await response.json()) as SessionListEnvelope
          latestSessionId = body.data?.[0]?.id
        }
      } catch {
        void 0
      }

      const { repoId: id, activeTab: tab, navigate: go, cloneStatus } = contextRef.current
      if (latestSessionId) {
        go(projectSessionPath(id, latestSessionId, tab), { replace: true })
        return
      }
      if (cloneStatus !== 'ready') return

      try {
        const created = await createSession(directory)
        if (created) {
          const current = contextRef.current
          current.navigate(projectSessionPath(current.repoId, created, current.activeTab), { replace: true })
        }
      } catch {
        void 0
      }
    })()

    return () => controller.abort()
  }, [directory])

  if (repoError) {
    return (
      <SessionRouteFallback
        message={t('session.route.repositoryNotFound')}
        backTo={getSessionListPath(false)}
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
