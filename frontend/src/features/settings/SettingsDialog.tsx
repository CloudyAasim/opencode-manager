import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { GeneralSettings } from '@/features/settings/GeneralSettings'
import { GitSettings } from '@/features/settings/GitSettings'
import { KeyboardShortcuts } from '@/features/settings/KeyboardShortcuts'
import { OpenCodeConfigManager } from '@/features/settings/OpenCodeConfigManager'
import { LogsViewer } from '@/features/settings/LogsViewer'
import { OpenCodeServerAuthSettings } from '@/features/settings/OpenCodeServerAuthSettings'
import { ManagerTokenSettings } from '@/features/settings/ManagerTokenSettings'
import { ServerEnvVarsSettings } from '@/features/settings/ServerEnvVarsSettings'
import { ServerHealthStatus } from '@/features/settings/ServerHealthStatus'
import { ProviderSettings } from '@/features/settings/ProviderSettings'
import { AccountSettings } from '@/features/settings/AccountSettings'
import { UsersSettings } from '@/features/settings/UsersSettings'
import { AuditSettings } from '@/features/settings/AuditSettings'
import { AssistantWorkspaceSettings } from '@/features/settings/AssistantWorkspaceSettings'
import { VoiceSettings } from '@/features/settings/VoiceSettings'
import { NotificationSettings } from '@/features/settings/NotificationSettings'
import { VersionSelectDialog } from '@/features/settings/VersionSelectDialog'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { RowActionsMenuContext } from '@/components/ui/settings-list'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Settings2, Keyboard, Code, ChevronLeft, Key, GitBranch, User, Users, History, Volume2, Bell, X, ScrollText, Bot, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSettingsDialog, isSettingsContentTab, type SettingsContentTab } from '@/hooks/useSettingsDialog'
import { useOptionalAuth } from '@/hooks/useAuth'
import { useI18n } from '@/lib/i18n'
import { DESKTOP_MEDIA_QUERY, useMediaQuery } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'

type SettingsView = 'menu' | SettingsContentTab

function OpenCodeSettings({ onOpenVersionDialog }: { onOpenVersionDialog: () => void }) {
  const [authSectionsOpen, setAuthSectionsOpen] = useState(true)
  const { t } = useI18n()
  const toggleAuthSections = useCallback(() => setAuthSectionsOpen((open) => !open), [])

  return (
    <RowActionsMenuContext.Provider value={true}>
      <div className="group/opencode-settings space-y-4" data-opencode-settings>
        <ServerHealthStatus onOpenVersionDialog={onOpenVersionDialog} />
        <OpenCodeConfigManager />
        <section className="space-y-4 border-t border-border pt-4" aria-label={t('settingsPanels.server.maintenance')}>
          <h2 className="text-lg font-semibold">{t('settingsPanels.server.maintenance')}</h2>
          <div className="grid grid-cols-1 items-start gap-x-6 gap-y-4 @min-[1000px]:grid-cols-2">
            <OpenCodeServerAuthSettings isOpen={authSectionsOpen} onToggle={toggleAuthSections} />
            <ManagerTokenSettings isOpen={authSectionsOpen} onToggle={toggleAuthSections} />
          </div>
          <ServerEnvVarsSettings />
        </section>
      </div>
    </RowActionsMenuContext.Provider>
  )
}

interface SettingsDialogProps {
  variant?: 'dialog' | 'page'
}

export function SettingsDialog({ variant = 'dialog' }: SettingsDialogProps = {}) {
  const { isOpen, close, activeTab, setActiveTab } = useSettingsDialog()
  const auth = useOptionalAuth()
  const user = auth?.user ?? null
  const { t } = useI18n()
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY)
  const [mobileView, setMobileView] = useState<SettingsView>('menu')
  const [isVersionDialogOpen, setIsVersionDialogOpen] = useState(false)
  const [sectionHistory, setSectionHistory] = useState<SettingsView[]>([])

  const pushSectionHistory = useCallback((view: SettingsView) => {
    if (view === 'menu') return
    setSectionHistory((history) => {
      if (history.at(-1) === view) return history
      return [...history, view]
    })
  }, [])

  const handleSettingsBack = useCallback(() => {
    if (mobileView === 'menu') {
      close()
      return
    }

    const currentIndex = sectionHistory.lastIndexOf(mobileView)
    const previousHistory = currentIndex >= 0
      ? sectionHistory.slice(0, currentIndex)
      : sectionHistory
    const previousView = previousHistory.at(-1)

    if (previousView && previousView !== 'menu') {
      setSectionHistory(previousHistory)
      setMobileView(previousView)
      setActiveTab(previousView)
      return
    }

    setSectionHistory([])
    setMobileView('menu')
  }, [mobileView, sectionHistory, close, setActiveTab])

  useEffect(() => {
    if (!isOpen) {
      setMobileView('menu')
      setSectionHistory([])
      return
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isVersionDialogOpen) {
        const target = e.target
        if (target instanceof Element) {
          const closestDialog = target.closest('[role="dialog"]')
          if (closestDialog && !closestDialog.hasAttribute('data-settings-dialog')) {
            return
          }
        }
        close()
      }
    }
    document.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [isOpen, close, isVersionDialogOpen])

  // The panel lives next to its menu entry. It used to be written out a
  // second time for the mobile view, so adding a setting meant editing two
  // places, and forgetting the second one meant it silently never showed
  // up on a phone.
  const menuItems: Array<{
    id: SettingsContentTab
    icon: LucideIcon
    label: string
    description: string
    contentClassName?: string
    // Both trees live in the DOM at once, so a panel that only makes
    // sense on one of them has to know which one is asking.
    render: (surface: 'desktop' | 'mobile') => ReactNode
  }> = [
    { id: 'account', icon: User, label: t('settings.menu.account.label'), description: t('settings.menu.account.description'), contentClassName: 'max-w-7xl', render: () => <AccountSettings /> },
    { id: 'general', icon: Settings2, label: t('settings.menu.general.label'), description: t('settings.menu.general.description'), contentClassName: 'max-w-4xl', render: () => <GeneralSettings /> },
    { id: 'notifications', icon: Bell, label: t('settings.menu.notifications.label'), description: t('settings.menu.notifications.description'), contentClassName: 'max-w-7xl', render: () => <NotificationSettings /> },
    { id: 'voice', icon: Volume2, label: t('settings.menu.voice.label'), description: t('settings.menu.voice.description'), contentClassName: 'max-w-7xl', render: () => <VoiceSettings /> },
    { id: 'git', icon: GitBranch, label: t('settings.menu.git.label'), description: t('settings.menu.git.description'), contentClassName: 'max-w-7xl', render: () => <GitSettings /> },
    { id: 'shortcuts', icon: Keyboard, label: t('settings.menu.shortcuts.label'), description: t('settings.menu.shortcuts.description'), contentClassName: 'max-w-7xl', render: () => <KeyboardShortcuts /> },
    { id: 'opencode', icon: Code, label: t('settings.menu.opencode.label'), description: t('settings.menu.opencode.description'), render: () => <OpenCodeSettings onOpenVersionDialog={() => setIsVersionDialogOpen(true)} /> },
    { id: 'assistant', icon: Bot, label: t('settings.menu.assistant.label'), description: t('settings.menu.assistant.description'), contentClassName: 'max-w-4xl', render: () => <AssistantWorkspaceSettings /> },
    { id: 'logs', icon: ScrollText, label: t('settings.menu.logs.label'), description: t('settings.menu.logs.description'), contentClassName: 'h-full min-h-0', render: (surface) => ((surface === 'desktop') === isDesktop ? <LogsViewer /> : null) },
    { id: 'providers', icon: Key, label: t('settings.menu.providers.label'), description: t('settings.menu.providers.description'), contentClassName: 'max-w-7xl', render: () => <ProviderSettings /> },
    ...(user?.role === 'admin'
      ? [
          { id: 'users' as const, icon: Users, label: t('settings.menu.users.label'), description: t('settings.menu.users.description'), contentClassName: 'max-w-7xl', render: () => <UsersSettings /> },
          { id: 'audit' as const, icon: History, label: t('settings.menu.audit.label'), description: t('settings.menu.audit.description'), contentClassName: 'max-w-7xl', render: () => <AuditSettings /> },
        ]
      : []),
  ]

  const handleOpenMobileView = useCallback((view: SettingsContentTab) => {
    setMobileView(view)
    setActiveTab(view)
    pushSectionHistory(view)
  }, [setActiveTab, pushSectionHistory])

  const handleTabChange = (tab: string) => {
    if (!isSettingsContentTab(tab)) return
    setActiveTab(tab)
    setMobileView(tab)
    pushSectionHistory(tab)
  }

  const content = (
    <>
         <div className="hidden sm:flex sm:h-full sm:min-h-0 sm:flex-col">
           <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-4">
             <h2 className="text-lg font-semibold text-foreground">{t('settings.title')}</h2>
             {variant !== 'page' && (
               <Button
                 variant="ghost"
                 size="icon"
                 onClick={close}
                 aria-label={t('common.close')}
                 className="text-muted-foreground hover:text-foreground"
               >
                 <X className="w-4 h-4" />
               </Button>
             )}
           </div>
          <Tabs
            defaultValue="account"
            value={activeTab}
            onValueChange={handleTabChange}
            orientation="vertical"
            className="flex min-h-0 w-full flex-1"
          >
            <TabsList className="flex h-full min-h-0 w-56 shrink-0 flex-col items-stretch justify-start overflow-y-auto rounded-none border-r border-border bg-card p-1">
              {menuItems.map((item) => (
                <TabsTrigger
                  key={item.id}
                  value={item.id}
                  className="shrink-0 justify-start gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors data-[state=active]:bg-accent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <div className={`@container min-h-0 min-w-0 flex-1 p-6 ${activeTab === 'logs' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
              {menuItems.map((item) => (
                <TabsContent
                  key={item.id}
                  value={item.id}
                  className={cn('mt-0 px-0', item.contentClassName)}
                >
                  {item.render('desktop')}
                </TabsContent>
              ))}
            </div>
          </Tabs>
        </div>

        <div className="sm:hidden flex flex-col h-full min-h-0">
           <div className="flex-shrink-0 bg-background/80 backdrop-blur-xl border-b border-border px-3 py-3 flex items-center justify-between">
             <div className="flex items-center gap-2 flex-1">
                {mobileView !== 'menu' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleSettingsBack}
                    className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px]"
                  >
                    <ChevronLeft className="w-6 h-6" />
                  </Button>
                )}
               <h2 className="text-xl font-semibold text-foreground">
                 {mobileView === 'menu' ? t('settings.title') : menuItems.find(item => item.id === mobileView)?.label}
               </h2>
             </div>
               {variant !== 'page' && (
                 <Button
                   variant="ghost"
                   size="icon"
                   onClick={close}
                   aria-label={t('common.close')}
                   className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex-shrink-0"
                 >
                  <X className="w-6 h-6" />
                 </Button>
               )}
             </div>

             <div className={`@container flex-1 min-h-0 p-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] ${mobileView === 'logs' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
             {mobileView === 'menu' && (
               <div className="space-y-3">
                 {menuItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleOpenMobileView(item.id)}
                      className="w-full bg-card hover:bg-card-hover border border-border rounded-xl p-4 transition-colors text-left"
                    >
                     <div className="flex items-center gap-4">
                       <div className="p-3 bg-accent rounded-lg">
                         <item.icon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                       </div>
                       <div className="flex-1 min-w-0">
                         <h3 className="font-semibold text-foreground mb-1">{item.label}</h3>
                         <p className="text-sm text-muted-foreground">{item.description}</p>
                       </div>
                     </div>
                   </button>
                 ))}
               </div>
             )}

              {menuItems.map((item) => (
                mobileView === item.id && (
                  <div key={item.id} className={item.id === 'logs' ? 'h-full min-h-0' : undefined}>
                    {item.render('mobile')}
                  </div>
                )
              ))}
           </div>
        </div>

    </>
  )

  if (variant === 'page') {
    return (
      <>
        <div className="flex h-full min-h-0 flex-col bg-background">{content}</div>
        <VersionSelectDialog open={isVersionDialogOpen} onOpenChange={setIsVersionDialogOpen} />
      </>
    )
  }

  return (
    <Dialog open={isOpen} modal={false} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="inset-0 w-full h-full max-w-none max-h-none p-0 rounded-none bg-background border-border overflow-hidden !flex !flex-col !gap-0"
        fullscreen
        canSwipeBack={() => mobileView !== 'menu'}
        onSwipeBack={handleSettingsBack}
        onInteractOutside={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        data-settings-dialog
      >
        <DialogTitle className="sr-only">{t('navigation.settings')}</DialogTitle>
        {content}
      </DialogContent>
      <VersionSelectDialog
        open={isVersionDialogOpen}
        onOpenChange={setIsVersionDialogOpen}
      />
    </Dialog>
  )
}
