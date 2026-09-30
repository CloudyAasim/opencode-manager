import { useEffect } from 'react'

type PrefetchLoader = () => Promise<unknown>

const PREFETCH_START_DELAY_MS = 5000

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
    let timer: number | undefined

    const run = async (loaders: PrefetchLoader[]) => {
      // One at a time on purpose. Firing all nine at once pulls ~70 chunks
      // in parallel, and on a cross-border link those speculative requests
      // are slower than the chunks the user is actually waiting for.
      for (const load of loaders) {
        if (cancelled) return
        try {
          await load()
        } catch {
          void 0
        }
      }
    }

    const warmAll = () => {
      if (cancelled) return
      void run(isAdmin ? [...AUTHENTICATED_ROUTES, ...ADMIN_ROUTES] : AUTHENTICATED_ROUTES)
    }

    const start = () => {
      if (cancelled || idleHandle !== undefined) return
      if (typeof window.requestIdleCallback === 'function') {
        idleHandle = window.requestIdleCallback(warmAll, { timeout: 5000 })
      } else {
        timer = window.setTimeout(warmAll, 2000)
      }
    }

    // Give the shell and the current route priority before speculating.
    timer = window.setTimeout(start, PREFETCH_START_DELAY_MS)

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
      if (idleHandle !== undefined) window.cancelIdleCallback(idleHandle)
    }
  }, [isAuthenticated, isAdmin])
}
