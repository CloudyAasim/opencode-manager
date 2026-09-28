import { useEffect } from 'react'

type PrefetchLoader = () => Promise<unknown>

const AUTHENTICATED_ROUTES: PrefetchLoader[] = [
  () => import('../pages/Repos'),
  () => import('../pages/RepoDetail'),
  () => import('../pages/SessionDetail'),
  () => import('../pages/AssistantRedirect'),
  () => import('../pages/Files'),
  () => import('../pages/Settings'),
  () => import('../pages/Schedules'),
  () => import('../pages/GlobalSchedules'),
]

const ADMIN_ROUTES: PrefetchLoader[] = [
  () => import('../pages/Terminal'),
]

interface NetworkInformation {
  saveData?: boolean
  effectiveType?: string
}

function shouldSkipPrefetch(): boolean {
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection
  if (!connection) return false
  if (connection.saveData) return true
  return connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g'
}

export function usePrefetchRoutes(isAuthenticated: boolean, isAdmin: boolean): void {
  useEffect(() => {
    if (!isAuthenticated || typeof window === 'undefined' || shouldSkipPrefetch()) return

    let cancelled = false
    const warm = (loaders: PrefetchLoader[]) => {
      for (const load of loaders) {
        if (cancelled) return
        void load().catch(() => undefined)
      }
    }
    const warmAll = () => {
      warm(AUTHENTICATED_ROUTES)
      if (isAdmin) warm(ADMIN_ROUTES)
    }

    const timer = setTimeout(warmAll, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [isAuthenticated, isAdmin])
}
