import type { ReactElement } from 'react'
import { createBrowserRouter, type NonIndexRouteObject } from 'react-router-dom'
import { RouteErrorBoundary } from '@/components/ui/route-error-boundary'
import {
  loginLoader,
  registerLoader,
  setupLoader,
  protectedLoader,
  terminalLoader,
} from '@/lib/auth-loaders'

export type PrefetchGroup = 'authenticated' | 'admin'

export interface PrefetchSpec {
  group: PrefetchGroup
  order: number
}

export interface AppRoute extends NonIndexRouteObject {
  prefetch?: PrefetchSpec
}

export const appRoutes: AppRoute[] = [
  {
    path: '/login',
    lazy: async () => ({ Component: (await import('./pages/Login')).Login }),
    loader: loginLoader,
  },
  {
    path: '/register',
    lazy: async () => ({ Component: (await import('./pages/Register')).Register }),
    loader: registerLoader,
  },
  {
    path: '/setup',
    lazy: async () => ({ Component: (await import('./pages/Setup')).Setup }),
    loader: setupLoader,
  },
  {
    path: '/',
    lazy: async () => ({ Component: (await import('./pages/Repos')).Repos }),
    loader: protectedLoader,
    prefetch: { group: 'authenticated', order: 1 },
  },
  {
    path: '/assistant',
    lazy: async () => ({ Component: (await import('./pages/SessionDetail')).SessionDetail }),
    loader: protectedLoader,
    prefetch: { group: 'authenticated', order: 4 },
  },
  {
    path: '/files',
    lazy: async () => ({ Component: (await import('./pages/Files')).Files }),
    loader: protectedLoader,
    prefetch: { group: 'authenticated', order: 5 },
  },
  {
    path: '/settings',
    lazy: async () => ({ Component: (await import('./pages/Settings')).Settings }),
    loader: protectedLoader,
    prefetch: { group: 'authenticated', order: 6 },
  },
  {
    path: '/repos/:id',
    lazy: async () => ({ Component: (await import('./pages/SessionDetail')).SessionDetail }),
    loader: protectedLoader,
    prefetch: { group: 'authenticated', order: 2 },
  },
  {
    path: '/repos/:id/assistant',
    lazy: async () => ({ Component: (await import('./pages/SessionDetail')).SessionDetail }),
    loader: protectedLoader,
  },
  {
    path: '/repos/:id/sessions/:sessionId',
    lazy: async () => ({ Component: (await import('./pages/SessionDetail')).SessionDetail }),
    loader: protectedLoader,
    prefetch: { group: 'authenticated', order: 3 },
  },
  {
    path: '/repos/:id/schedules',
    lazy: async () => ({ Component: (await import('./pages/Schedules')).Schedules }),
    loader: protectedLoader,
    prefetch: { group: 'authenticated', order: 7 },
  },
  {
    path: '/schedules',
    lazy: async () => ({ Component: (await import('./pages/GlobalSchedules')).GlobalSchedules }),
    loader: protectedLoader,
    prefetch: { group: 'authenticated', order: 8 },
  },
  {
    path: '/terminal',
    lazy: async () => ({ Component: (await import('./pages/Terminal')).TerminalPage }),
    loader: terminalLoader,
    prefetch: { group: 'admin', order: 9 },
  },
  {
    path: '*',
    lazy: async () => ({ Component: (await import('./pages/NotFound')).NotFound }),
    loader: protectedLoader,
  },
]

export function createAppRouter(shell: ReactElement) {
  return createBrowserRouter([
    { element: shell, errorElement: <RouteErrorBoundary />, children: appRoutes },
  ])
}

export type PrefetchLoader = () => Promise<unknown>

export function prefetchLoaders(groups: readonly PrefetchGroup[]): PrefetchLoader[] {
  const entries: Array<{ order: number; load: PrefetchLoader }> = []
  for (const route of appRoutes) {
    const spec = route.prefetch
    const lazy = route.lazy
    if (!spec || !groups.includes(spec.group)) continue
    if (typeof lazy !== 'function') continue
    entries.push({ order: spec.order, load: lazy })
  }
  entries.sort((left, right) => left.order - right.order)
  return entries.map((entry) => entry.load)
}
