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
    let idleHandle: number | undefined
    const warm = (loaders: PrefetchLoader[]) => {
      for (const load of loaders) {
        if (cancelled) return
        void load().catch(() => undefined)
      }
    }
    const warmAll = () => {
      if (cancelled) return
      warm(AUTHENTICATED_ROUTES)
      if (isAdmin) warm(ADMIN_ROUTES)
    }

    // Only warm the other routes once the browser is idle, so the critical
    // chunks for what the user actually opened are never queued behind ~70
    // speculative requests competing for the same connection.
    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(warmAll, { timeout: 3000 })
      return () => {
        cancelled = true
        if (idleHandle !== undefined) window.cancelIdleCallback(idleHandle)
      }
    }

    const timer = setTimeout(warmAll, 1500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [isAuthenticated, isAdmin])
}
