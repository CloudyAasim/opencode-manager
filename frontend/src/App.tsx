
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useRef, useCallback } from 'react'
import { Toaster } from 'sonner'
import { VersionNotifier } from './components/VersionNotifier'
import { PwaUpdatePrompt } from '@/components/PwaUpdatePrompt'
import { MobileSheetHost } from '@/features/navigation/MobileSheetHost'
import { createAppRouter } from './routes'
import { LayerProvider } from './framework/layer/LayerProvider'
import { ShellFrame } from './framework/shell/ShellFrame'
import { StatusBar } from './framework/shell/StatusBar'
import { TopBar } from './framework/shell/TopBar'
import { Inspector } from './framework/shell/Inspector'
import { InspectorProvider } from './framework/inspector/InspectorProvider'
import { FileBrowserInspectorTab } from './features/file-browser/InspectorTab'
import { SourceControlInspectorTab } from './features/source-control/InspectorTab'
import { TerminalInspectorTab } from './features/terminal/InspectorTab'
import { CommandProvider } from './framework/commands/CommandProvider'
import { CommandPalette } from './framework/commands/CommandPalette'
import { BuiltinCommands } from './framework/commands/BuiltinCommands'
import { InspectorCommands } from './framework/commands/InspectorCommands'
import { useTheme } from './hooks/useTheme'
import { useRightEdgeSwipe, useSwipeBack } from './hooks/useMobile'
import { useMobileSheets } from '@/hooks/useMobileSheets'
import { useDesktop } from './hooks/useDesktop'
import { TTSProvider } from './contexts/TTSContext'
import { AuthProvider } from './contexts/AuthContext'
import { EventProvider, usePermissions, useEventContext } from '@/contexts/EventContext'
import { SwipeNavigationProvider, useSwipeNavigation } from '@/contexts/SwipeNavigationContext'
import { PermissionRequestDialog } from './features/session/PermissionRequestDialog'
import { SSHHostKeyDialog } from '@/features/ssh/SSHHostKeyDialog'
import { getSwipeBackTarget } from '@/lib/navigation'
import { onNotificationClick } from '@/lib/serviceWorker'
import { useAuth } from '@/hooks/useAuth'
import { useServerHealth } from '@/hooks/useServerHealth'
import { usePrefetchRoutes } from '@/hooks/usePrefetchRoutes'

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
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const rootRef = useRef<HTMLDivElement>(null)
  const { openSheet, open } = useMobileSheets()
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
    <EventProvider>
      <LayerProvider>
        <CommandProvider>
          <InspectorProvider>
            <FileBrowserInspectorTab />
            <SourceControlInspectorTab />
            <TerminalInspectorTab />
            <InspectorCommands />
            <BuiltinCommands />
            <CommandPalette />
            <ShellFrame
              rootRef={rootRef}
              chrome={isAuthenticated}
              header={<TopBar />}
              main={<Outlet />}
              status={<StatusBar />}
              inspector={<Inspector />}
            />
            <MobileSheetHost />
            <PermissionDialogWrapper />
            <SSHHostKeyDialogWrapper />
            <HealthMonitor />
            <RoutePrefetcher />
            <VersionNotifier />
            <PwaUpdatePrompt />
          </InspectorProvider>
          <Toaster
            position={isDesktop ? 'bottom-right' : 'top-center'}
            offset={isDesktop ? undefined : '64px'}
            expand={false}
            richColors
            closeButton
            duration={2500}
          />
        </CommandProvider>
      </LayerProvider>
    </EventProvider>
  )
}

const router = createAppRouter(
  <AuthProvider>
    <AppShell />
  </AuthProvider>,
)
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
