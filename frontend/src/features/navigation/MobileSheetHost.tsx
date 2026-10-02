import { Suspense, lazy } from 'react'
import { Menu } from 'lucide-react'
import { useMobileTabBar } from '@/hooks/useMobileTabBar'
import { useMobile } from '@/hooks/useMobile'
import { useI18n } from '@/lib/i18n'

const RepoQuickSwitchSheet = lazy(() =>
  import('@/features/navigation/RepoQuickSwitchSheet').then((m) => ({ default: m.RepoQuickSwitchSheet })),
)
const FileBrowserSheet = lazy(() =>
  import('@/features/file-browser/FileBrowserSheet').then((m) => ({ default: m.FileBrowserSheet })),
)
const NotificationsSheet = lazy(() =>
  import('@/features/navigation/NotificationsSheet').then((m) => ({ default: m.NotificationsSheet })),
)
const MoreDrawer = lazy(() =>
  import('@/features/navigation/MoreDrawer').then((m) => ({ default: m.MoreDrawer })),
)

export function MobileSheetHost() {
  const isMobile = useMobile()
  const { openSheet, open, close } = useMobileTabBar()
  const { t } = useI18n()

  if (!isMobile) return null

  return (
    <Suspense fallback={null}>
      <RepoQuickSwitchSheet isOpen={openSheet === 'repos'} onClose={close} />
      {openSheet === 'files' && (
        <FileBrowserSheet
          isOpen
          onClose={close}
          basePath=""
          repoName={t('navigation.workspaceRoot')}
          allowNavigateAboveBase={true}
        />
      )}
      {openSheet === 'notifications' && <NotificationsSheet isOpen onClose={close} />}
      <MoreDrawer isOpen={openSheet === 'more'} onClose={close} />
      <button
        type="button"
        aria-label={t('navigation.more')}
        title={t('navigation.more')}
        onClick={() => open('more')}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] right-3 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card/95 text-foreground shadow-lg backdrop-blur transition-colors active:bg-accent"
      >
        <Menu className="h-5 w-5" />
      </button>
    </Suspense>
  )
}
