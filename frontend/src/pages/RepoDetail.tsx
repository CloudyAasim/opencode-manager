import { useCallback, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useCreateSession } from '@/hooks/useOpenCode'
import { getRepo } from '@/api/repos'
import { OPENCODE_API_ENDPOINT } from '@/config'
import { projectSessionPath } from '@/lib/project-session-path'
import { useI18n } from '@/lib/i18n'
import { useWorktreeTab } from '@/hooks/useWorktreeTab'
import { SessionRouteFallback } from '@/features/session/SessionRouteFallback'
import { getSessionListPath } from '@/lib/navigation'

interface SessionListEnvelope {
  data?: Array<{ id?: string }>
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
  const navigateToSession = useCallback((sessionId: string | undefined) => {
    // A create response without an id used to be filtered out by `if (created)`.
    // Without this the router builds a path containing "undefined".
    if (typeof sessionId !== 'string' || sessionId.length === 0) return
    const current = contextRef.current
    current.navigate(projectSessionPath(current.repoId, sessionId, current.activeTab), { replace: true })
  }, [])

  // Goes through the hook rather than a bare fetch, so the session list learns
  // this session exists. A session created behind the cache's back is a session
  // the list never shows.
  const createSession = useCreateSession(OPENCODE_API_ENDPOINT, directory, (session) =>
    navigateToSession(session.id),
  )
  const createSessionRef = useRef(createSession)
  createSessionRef.current = createSession

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
        await createSessionRef.current.mutateAsync({ agent: undefined })
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

  // No placeholder session list here any more. This route is a hop, not a
  // place: it resolves the session to open and goes there. Drawing five
  // skeleton rows that looked like a session list only made the hop visible.
  return (
    <div className="flex h-dvh max-h-dvh items-center justify-center bg-background">
      <span className="sr-only" role="status">{t('repo.loading')}</span>
    </div>
  )
}
