import { lazy, type ComponentType, type ReactElement } from 'react'
import { createBrowserRouter, type NonIndexRouteObject } from 'react-router-dom'
import { RouterBootFallback } from '@/framework/shell/RouterBootFallback'
import { RouteErrorBoundary } from '@/components/ui/route-error-boundary'
import {
  loginLoader,
  registerLoader,
  setupLoader,
  protectedLoader,
  terminalLoader,
  openCodeSettingsLoader,
} from '@/lib/auth-loaders'

export type PrefetchGroup = 'authenticated' | 'admin'

export interface PrefetchSpec {
  group: PrefetchGroup
  order: number
}

export interface AppRoute extends NonIndexRouteObject {
  prefetch?: PrefetchSpec
  /** The chunk this route needs, warmed before anyone asks for it. */
  prefetchLoad?: () => Promise<unknown>
  /** Which page module this route shows. */
  page?: keyof typeof pageModules
}

/**
 * The page modules.
 *
 * They are loaded through `React.lazy` rather than through the router's
 * own `lazy`, and the reason is the wait.
 *
 * The router treats a route's `lazy` as part of loading that route: it
 * waits for the module before it renders the route, so switching to a
 * page whose chunk is not in memory yet means staring at the page you
 * just left until the chunk has travelled the network and come back.
 *
 * `React.lazy` hands the same work to React, and React renders the
 * fallback while the chunk is on its way. The route appears at once, with
 * a loading state in the place where its content will be.
 *
 * The names of the page modules are read out of this file by the service
 * worker's precache plugin, so the import paths have to stay in the shape
 * it recognises: a dynamic import of a module directly under `pages/`. A
 * worked example written out in a comment would be read as a route.
 */
export const pageModules = {
  login: () => import('./pages/Login'),
  register: () => import('./pages/Register'),
  setup: () => import('./pages/Setup'),
  repos: () => import('./pages/Repos'),
  sessionDetail: () => import('./pages/SessionDetail'),
  openCodeSettings: () => import('./pages/OpenCodeSettings'),
  files: () => import('./pages/Files'),
  settings: () => import('./pages/Settings'),
  schedules: () => import('./pages/Schedules'),
  globalSchedules: () => import('./pages/GlobalSchedules'),
  terminal: () => import('./pages/Terminal'),
  notFound: () => import('./pages/NotFound'),
}

export type PageModuleKey = keyof typeof pageModules

const lazyPage = (key: PageModuleKey, exportName: string) =>
  lazy(async () => {
    const module = (await pageModules[key]()) as unknown as Record<string, ComponentType>
    const Component = module[exportName]
    if (!Component) throw new Error(`pages/${key} has no export named ${exportName}`)
    return { default: Component }
  })

interface PageRouteOptions {
  path: string
  /** Which page module the route shows. */
  page: PageModuleKey
  /** The export the page module carries. */
  exportName: string
  loader?: NonIndexRouteObject['loader']
  prefetch?: PrefetchSpec
}

/**
 * One route, and the chunk it needs.
 *
 * The element and the chunk to warm come from the same page module on
 * purpose: warming a chunk the route will not load spends bandwidth for
 * nothing, and it is the kind of mistake nothing else notices.
 */
function pageRoute({ path, page, exportName, loader, prefetch }: PageRouteOptions): AppRoute {
  const Page = lazyPage(page, exportName)
  return {
    path,
    element: <Page />,
    loader,
    prefetch,
    prefetchLoad: prefetch ? pageModules[page] : undefined,
    page,
  }
}

export const appRoutes: AppRoute[] = [
  pageRoute({ path: '/login', page: 'login', exportName: 'Login', loader: loginLoader }),
  pageRoute({ path: '/register', page: 'register', exportName: 'Register', loader: registerLoader }),
  pageRoute({ path: '/setup', page: 'setup', exportName: 'Setup', loader: setupLoader }),
  pageRoute({
    path: '/',
    page: 'repos',
    exportName: 'Repos',
    loader: protectedLoader,
    prefetch: { group: 'authenticated', order: 1 },
  }),
  pageRoute({
    path: '/assistant',
    page: 'sessionDetail',
    exportName: 'SessionDetail',
    loader: protectedLoader,
    prefetch: { group: 'authenticated', order: 4 },
  }),
  pageRoute({
    path: '/settings/opencode',
    page: 'openCodeSettings',
    exportName: 'OpenCodeSettings',
    loader: openCodeSettingsLoader,
    prefetch: { group: 'admin', order: 10 },
  }),
  pageRoute({
    path: '/files',
    page: 'files',
    exportName: 'Files',
    loader: protectedLoader,
    prefetch: { group: 'authenticated', order: 5 },
  }),
  pageRoute({
    path: '/settings',
    page: 'settings',
    exportName: 'Settings',
    loader: protectedLoader,
    prefetch: { group: 'authenticated', order: 6 },
  }),
  pageRoute({
    path: '/repos/:id',
    page: 'sessionDetail',
    exportName: 'SessionDetail',
    loader: protectedLoader,
    prefetch: { group: 'authenticated', order: 2 },
  }),
  pageRoute({
    path: '/repos/:id/assistant',
    page: 'sessionDetail',
    exportName: 'SessionDetail',
    loader: protectedLoader,
  }),
  pageRoute({
    path: '/repos/:id/sessions/:sessionId',
    page: 'sessionDetail',
    exportName: 'SessionDetail',
    loader: protectedLoader,
    prefetch: { group: 'authenticated', order: 3 },
  }),
  pageRoute({
    path: '/repos/:id/schedules',
    page: 'schedules',
    exportName: 'Schedules',
    loader: protectedLoader,
    prefetch: { group: 'authenticated', order: 7 },
  }),
  pageRoute({
    path: '/schedules',
    page: 'globalSchedules',
    exportName: 'GlobalSchedules',
    loader: protectedLoader,
    prefetch: { group: 'authenticated', order: 8 },
  }),
  pageRoute({
    path: '/terminal',
    page: 'terminal',
    exportName: 'TerminalPage',
    loader: terminalLoader,
    prefetch: { group: 'admin', order: 9 },
  }),
  pageRoute({ path: '*', page: 'notFound', exportName: 'NotFound', loader: protectedLoader }),
]

export function createAppRouter(shell: ReactElement) {
  return createBrowserRouter([
    {
      element: shell,
      errorElement: <RouteErrorBoundary />,
      HydrateFallback: RouterBootFallback,
      children: appRoutes,
    },
  ])
}

export type PrefetchLoader = () => Promise<unknown>

export function prefetchLoaders(groups: readonly PrefetchGroup[]): PrefetchLoader[] {
  const entries: Array<{ order: number; load: PrefetchLoader }> = []
  for (const route of appRoutes) {
    const spec = route.prefetch
    if (!spec || !groups.includes(spec.group)) continue
    const load = route.prefetchLoad
    if (!load) continue
    entries.push({ order: spec.order, load })
  }
  entries.sort((left, right) => left.order - right.order)
  return entries.map((entry) => entry.load)
}
