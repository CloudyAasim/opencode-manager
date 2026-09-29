import { Suspense, lazy } from 'react'
import { useMobileTabBar } from '@/hooks/useMobileTabBar'
import { useMobile } from '@/hooks/useMobile'
import { useI18n } from '@/lib/i18n'

const RepoQuickSwitchSheet = lazy(() =>
  import('@/components/navigation/RepoQuickSwitchSheet').then((m) => ({ default: m.RepoQuickSwitchSheet })),
)
const FileBrowserSheet = lazy(() =>
  import('@/components/file-browser/FileBrowserSheet').then((m) => ({ default: m.FileBrowserSheet })),
)
const NotificationsSheet = lazy(() =>
  import('@/components/navigation/NotificationsSheet').then((m) => ({ default: m.NotificationsSheet })),
)
const MoreDrawer = lazy(() =>
  import('@/components/navigation/MoreDrawer').then((m) => ({ default: m.MoreDrawer })),
)

export function MobileSheetHost() {
  const isMobile = useMobile()
  const { openSheet, close } = useMobileTabBar()
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
    </Suspense>
  )
}
