import { useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
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
    <div className="flex h-dvh max-h-dvh flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
        <div className="h-7 w-7 shrink-0 animate-pulse rounded-md bg-muted" />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="h-3 w-28 animate-pulse rounded bg-muted" />
          <div className="h-2.5 w-16 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-hidden p-3">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="flex items-center gap-3 rounded-lg border border-border p-3">
            <div className="h-8 w-8 shrink-0 animate-pulse rounded-md bg-muted" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
              <div className="h-2.5 w-3/5 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only" role="status">{t('repo.loading')}</span>
    </div>
  )
}
