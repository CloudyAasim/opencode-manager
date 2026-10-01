import { useEffect } from 'react'
import { prefetchLoaders } from '@/routes'

const PREFETCH_START_DELAY_MS = 5000

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

    const run = async (loaders: Array<() => Promise<unknown>>) => {
      // One at a time on purpose. Firing them all at once pulls every chunk in
      // parallel, and on a cross-border link those speculative requests are
      // slower than the chunks the user is actually waiting for.
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
      const groups = isAdmin ? (['authenticated', 'admin'] as const) : (['authenticated'] as const)
      void run(prefetchLoaders(groups))
    }

    const start = () => {
      if (cancelled || idleHandle !== undefined) return
      if (typeof window.requestIdleCallback === 'function') {
        idleHandle = window.requestIdleCallback(warmAll, { timeout: 5000 })
      } else {
        timer = window.setTimeout(warmAll, 2000)
      }
    }

    timer = window.setTimeout(start, PREFETCH_START_DELAY_MS)

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
      if (idleHandle !== undefined) window.cancelIdleCallback(idleHandle)
    }
  }, [isAuthenticated, isAdmin])
}
