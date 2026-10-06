import { Header } from '@/components/ui/header'
import { RowActionsMenuContext } from '@/components/ui/settings-list'
import { OpenCodeCoreSettings } from './OpenCodeCoreSettings'
import { OpenCodeConfigManager } from './OpenCodeConfigManager'
import { useI18n } from '@/lib/i18n'

/**
 * The one place an administrator edits the configuration every session on the
 * server reads.
 *
 * It lives on its own route rather than as another entry in the settings
 * dialog because it is not the same kind of thing as the rest of the settings:
 * it writes one shared document, so an accidental edit here is an edit to
 * everyone. A URL of its own also makes "go and look at the server config" a
 * link rather than a few clicks through a menu.
 */
export function OpenCodeSettingsView() {
  const { t } = useI18n()

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-background">
      <Header>
        <Header.BackButton to="/settings" />
        <Header.Title>{t('settingsPanels.coreConfig.pageTitle')}</Header.Title>
      </Header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <RowActionsMenuContext.Provider value={true}>
          <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
            <OpenCodeCoreSettings />
            <OpenCodeConfigManager />
          </div>
        </RowActionsMenuContext.Provider>
      </main>
    </div>
  )
}