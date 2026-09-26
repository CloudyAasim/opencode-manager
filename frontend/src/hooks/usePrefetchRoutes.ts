import { useEffect } from 'react'

type PrefetchLoader = () => Promise<unknown>

const AUTHENTICATED_ROUTES: PrefetchLoader[] = [
  () => import('../pages/Repos'),
  () => import('../pages/RepoDetail'),
  () => import('../pages/Schedules'),
  () => import('../pages/GlobalSchedules'),
  () => import('../pages/AssistantRedirect'),
  () => import('../pages/SessionDetail'),
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

    const requestIdle = (globalThis as {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
    }).requestIdleCallback

    if (typeof requestIdle === 'function') {
      const handle = requestIdle(warmAll, { timeout: 4000 })
      return () => {
        cancelled = true
        const cancelIdle = (globalThis as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback
        if (typeof cancelIdle === 'function') cancelIdle(handle)
      }
    }

    const timer = setTimeout(warmAll, 2000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [isAuthenticated, isAdmin])
}
