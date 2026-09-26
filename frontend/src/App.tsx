
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { lazy, Suspense, useEffect, useRef, useCallback } from 'react'
import { Toaster } from 'sonner'
import { VersionNotifier } from './components/VersionNotifier'
import { PwaUpdatePrompt } from '@/components/PwaUpdatePrompt'
import { MobileTabBar } from '@/components/navigation/MobileTabBar'
import { MobileSheetHost } from '@/components/navigation/MobileSheetHost'
import { RouteErrorBoundary } from '@/components/ui/route-error-boundary'
import { DesktopSidebar } from '@/components/navigation/DesktopSidebar'
import { useTheme } from './hooks/useTheme'
import { useRightEdgeSwipe, useSwipeBack } from './hooks/useMobile'
import { useMobileTabBar } from '@/hooks/useMobileTabBar'
import { TTSProvider } from './contexts/TTSContext'
import { AuthProvider } from './contexts/AuthContext'
import { EventProvider, usePermissions, useEventContext } from '@/contexts/EventContext'
import { SwipeNavigationProvider, useSwipeNavigation } from '@/contexts/SwipeNavigationContext'
import { PermissionRequestDialog } from './components/session/PermissionRequestDialog'
import { SSHHostKeyDialog } from './components/ssh/SSHHostKeyDialog'
import { loginLoader, setupLoader, registerLoader, protectedLoader, adminLoader } from './lib/auth-loaders'
import { getSwipeBackTarget } from '@/lib/navigation'
import { onNotificationClick } from '@/lib/serviceWorker'
import { useAuth } from '@/hooks/useAuth'
import { useServerHealth } from '@/hooks/useServerHealth'
import { usePrefetchRoutes } from '@/hooks/usePrefetchRoutes'

const LazySettingsDialog = lazy(() =>
  import('./components/settings/SettingsDialog').then((module) => ({ default: module.SettingsDialog }))
)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      gcTime: 1000 * 60 * 30,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
    mutations: {
      retry: 0,
    },
  },
})

function SSHHostKeyDialogWrapper() {
  const { sshHostKey } = useEventContext()
  return (
    <SSHHostKeyDialog
      request={sshHostKey.request}
      onRespond={async (requestId, response) => {
        await sshHostKey.respond(requestId, response === 'accept')
      }}
    />
  )
}

function HealthMonitor() {
  const { isAuthenticated } = useAuth()
  useServerHealth(isAuthenticated)
  return null
}

function RoutePrefetcher() {
  const { isAuthenticated, user } = useAuth()
  usePrefetchRoutes(isAuthenticated, user?.role === 'admin')
  return null
}

function PermissionDialogWrapper() {
  const {
    current: currentPermission,
    pendingCount,
    respond: respondToPermission,
    showDialog,
    setShowDialog,
  } = usePermissions()

  return (
    <PermissionRequestDialog
      permission={currentPermission}
      pendingCount={pendingCount}
      isFromDifferentSession={false}
      onRespond={respondToPermission}
      open={showDialog}
      onOpenChange={setShowDialog}
      repoDirectory={null}
    />
  )
}

function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const settingsOpen = new URLSearchParams(location.search).get('settings') === 'open'
  const rootRef = useRef<HTMLDivElement>(null)
  const { openSheet, open } = useMobileTabBar()
  useTheme()

  const swipeNav = useSwipeNavigation()

  const getRouteSwipeBackTarget = useCallback(
    () => getSwipeBackTarget(location.pathname, location.search),
    [location.pathname, location.search]
  )

  const canSwipeBack = useCallback(
    () => !swipeNav?.isSuspended() && getRouteSwipeBackTarget() !== null,
    [swipeNav, getRouteSwipeBackTarget]
  )

  const handleSwipeBack = useCallback(() => {
    const target = getRouteSwipeBackTarget()
    if (target) navigate(target)
  }, [getRouteSwipeBackTarget, navigate])

  const { bind: bindRouteSwipe } = useSwipeBack(
    () => {},
    {
      enabled: true,
      suspendsRouteSwipe: false,
      canBack: canSwipeBack,
      onBack: handleSwipeBack,
    }
  )

  const canOpenMoreWithSwipe = () => {
    return /^\/repos\/[^/]+\/sessions\/[^/]+$/.test(location.pathname) && !openSheet
  }

  const { bind: bindMoreSwipe } = useRightEdgeSwipe(
    () => open('more'),
    {
      enabled: canOpenMoreWithSwipe(),
      edgeWidth: 32,
      threshold: 60,
    }
  )

  useEffect(() => {
    const cleanup = bindRouteSwipe(rootRef.current)
    return () => {
      cleanup?.()
    }
  }, [bindRouteSwipe])

  useEffect(() => {
    const cleanup = bindMoreSwipe(rootRef.current)
    return () => {
      cleanup?.()
    }
  }, [bindMoreSwipe])

  useEffect(
    () =>
      onNotificationClick((url) => {
        if (window.location.pathname + window.location.search !== url) navigate(url)
      }),
    [navigate]
  )

  return (
    <AuthProvider>
      <EventProvider>
        <div ref={rootRef} className="flex h-dvh w-full min-w-0">
          <DesktopSidebar />
          <main className="flex-1 min-w-0 min-h-0 flex flex-col">
            <Outlet />
          </main>
        </div>
        <MobileTabBar />
        <MobileSheetHost />
        <PermissionDialogWrapper />
        <SSHHostKeyDialogWrapper />
        {settingsOpen && (
          <Suspense fallback={null}>
            <LazySettingsDialog />
          </Suspense>
        )}
        <HealthMonitor />
        <RoutePrefetcher />
        <VersionNotifier />
        <PwaUpdatePrompt />
        <Toaster
          position="bottom-right"
          expand={false}
          richColors
          closeButton
          duration={2500}
        />
      </EventProvider>
    </AuthProvider>
  )
}

const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <RouteErrorBoundary />,
    children: [
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
      },
      {
        path: '/assistant',
        lazy: async () => ({ Component: (await import('./pages/AssistantRedirect')).AssistantRedirect }),
        loader: protectedLoader,
      },
      {
        path: '/repos/:id',
        lazy: async () => ({ Component: (await import('./pages/RepoDetail')).RepoDetail }),
        loader: protectedLoader,
      },
      {
        path: '/repos/:id/assistant',
        lazy: async () => ({ Component: (await import('./pages/AssistantRedirect')).AssistantRedirect }),
        loader: protectedLoader,
      },
      {
        path: '/repos/:id/sessions/:sessionId',
        lazy: async () => ({ Component: (await import('./pages/SessionDetail')).SessionDetail }),
        loader: protectedLoader,
      },
      {
        path: '/repos/:id/schedules',
        lazy: async () => ({ Component: (await import('./pages/Schedules')).Schedules }),
        loader: protectedLoader,
      },
      {
        path: '/schedules',
        lazy: async () => ({ Component: (await import('./pages/GlobalSchedules')).GlobalSchedules }),
        loader: protectedLoader,
      },
      {
        path: '/terminal',
        lazy: async () => ({ Component: (await import('./pages/Terminal')).TerminalPage }),
        loader: adminLoader,
      },
    ],
  },
])

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TTSProvider>
        <SwipeNavigationProvider>
          <RouterProvider router={router} />
        </SwipeNavigationProvider>
      </TTSProvider>
    </QueryClientProvider>
  )
}

export default App
