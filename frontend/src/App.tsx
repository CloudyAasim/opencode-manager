
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Suspense, lazy, useEffect, useRef, useCallback } from 'react'
import { Toaster } from 'sonner'
import { VersionNotifier } from './components/VersionNotifier'
import { PwaUpdatePrompt } from '@/components/PwaUpdatePrompt'
import { MobileSheetHost } from '@/components/navigation/MobileSheetHost'
import { createAppRouter } from './routes'
import { useTheme } from './hooks/useTheme'
import { useRightEdgeSwipe, useSwipeBack } from './hooks/useMobile'
import { useMobileTabBar } from '@/hooks/useMobileTabBar'
import { useDesktop } from './hooks/useDesktop'
import { TTSProvider } from './contexts/TTSContext'
import { AuthProvider } from './contexts/AuthContext'
import { EventProvider, usePermissions, useEventContext } from '@/contexts/EventContext'
import { SwipeNavigationProvider, useSwipeNavigation } from '@/contexts/SwipeNavigationContext'
import { PermissionRequestDialog } from './components/session/PermissionRequestDialog'
import { SSHHostKeyDialog } from './components/ssh/SSHHostKeyDialog'
import { getSwipeBackTarget } from '@/lib/navigation'
import { onNotificationClick } from '@/lib/serviceWorker'
import { useAuth } from '@/hooks/useAuth'
import { useServerHealth } from '@/hooks/useServerHealth'
import { usePrefetchRoutes } from '@/hooks/usePrefetchRoutes'

const DesktopSidebar = lazy(() =>
  import('@/components/navigation/DesktopSidebar').then((m) => ({ default: m.DesktopSidebar })),
)
const MobileTabBar = lazy(() =>
  import('@/components/navigation/MobileTabBar').then((m) => ({ default: m.MobileTabBar })),
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
  const rootRef = useRef<HTMLDivElement>(null)
  const { openSheet, open } = useMobileTabBar()
  const isDesktop = useDesktop()
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
          {isDesktop && (
            <Suspense fallback={null}>
              <DesktopSidebar />
            </Suspense>
          )}
          <main className="flex-1 min-w-0 min-h-0 flex flex-col">
            <Outlet />
          </main>
        </div>
        {!isDesktop && (
          <Suspense fallback={null}>
            <MobileTabBar />
          </Suspense>
        )}
        <MobileSheetHost />
        <PermissionDialogWrapper />
        <SSHHostKeyDialogWrapper />
        <HealthMonitor />
        <RoutePrefetcher />
        <VersionNotifier />
        <PwaUpdatePrompt />
        <Toaster
          position={isDesktop ? 'bottom-right' : 'top-center'}
          offset={isDesktop ? undefined : '64px'}
          expand={false}
          richColors
          closeButton
          duration={2500}
        />
      </EventProvider>
    </AuthProvider>
  )
}

const router = createAppRouter(<AppShell />)
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
