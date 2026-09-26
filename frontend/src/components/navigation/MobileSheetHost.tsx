import { useMobileTabBar } from '@/hooks/useMobileTabBar'
import { useMobile } from '@/hooks/useMobile'
import { FileBrowserSheet } from '@/components/file-browser/FileBrowserSheet'
import { RepoQuickSwitchSheet } from '@/components/navigation/RepoQuickSwitchSheet'
import { NotificationsSheet } from '@/components/navigation/NotificationsSheet'
import { MoreDrawer } from '@/components/navigation/MoreDrawer'
import { useI18n } from '@/lib/i18n'

export function MobileSheetHost() {
  const isMobile = useMobile()
  const { openSheet, close } = useMobileTabBar()
  const { t } = useI18n()

  if (!isMobile) return null

  return (
    <>
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
    </>
  )
}
