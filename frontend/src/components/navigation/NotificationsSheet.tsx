import { BottomSheet, BottomSheetHeader, BottomSheetContent } from '@/components/ui/bottom-sheet'
import { usePermissions, useQuestions } from '@/contexts/EventContext'
import { getQuestionText } from '@opencode-manager/shared/notifications'
import { useI18n } from '@/lib/i18n'
import { Bell, HelpCircle } from 'lucide-react'

interface NotificationsSheetProps {
  isOpen: boolean
  onClose: () => void
}

export function NotificationsSheet({ isOpen, onClose }: NotificationsSheetProps) {
  const { t } = useI18n()
  const {
    current: currentPermission,
    pendingCount: permissionCount,
    setShowDialog,
    navigateToCurrent: navigateToPermission,
  } = usePermissions()
  const {
    current: currentQuestion,
    pendingCount: questionCount,
    navigateToCurrent: navigateToQuestion,
  } = useQuestions()

  const handlePermissionClick = () => {
    navigateToPermission()
    setShowDialog(true)
    onClose()
  }

  const handleQuestionClick = () => {
    navigateToQuestion()
    onClose()
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} ariaLabel={t('navigation.notifications')}>
      <BottomSheetHeader title={t('navigation.notifications')} />
      <BottomSheetContent className="flex flex-col gap-4">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Bell className="w-5 h-5 text-orange-500" />
            <h3 className="font-semibold text-foreground">{t('navigation.pendingPermissions')}</h3>
          </div>
          {permissionCount === 0 ? (
            <div className="text-muted-foreground text-sm py-4">
              {t('navigation.allCaughtUp')}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {currentPermission && (
                <button
                  type="button"
                  onClick={handlePermissionClick}
                  className="flex flex-col items-start gap-1 p-3 rounded-lg border border-border hover:bg-accent transition-colors text-left w-full"
                >
                  <span className="font-medium text-foreground capitalize">
                    {currentPermission.permission.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-muted-foreground truncate w-full">
                    {currentPermission.patterns?.[0] || t('navigation.viewDetails')}
                  </span>
                </button>
              )}
              {permissionCount > 1 && (
                <div className="text-xs text-muted-foreground px-3">
                  {t('navigation.moreCount', { count: permissionCount - 1 })}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <HelpCircle className="w-5 h-5 text-blue-500" />
            <h3 className="font-semibold text-foreground">{t('navigation.pendingQuestions')}</h3>
          </div>
          {questionCount === 0 ? (
            <div className="text-muted-foreground text-sm py-4">
              {t('navigation.allCaughtUp')}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {currentQuestion && (
                <button
                  type="button"
                  onClick={handleQuestionClick}
                  className="flex flex-col items-start gap-1 p-3 rounded-lg border border-border hover:bg-accent transition-colors text-left w-full"
                >
                  <span className="font-medium text-foreground">
                    {getQuestionText(currentQuestion) || t('navigation.question')}
                  </span>
                  <span className="text-xs text-muted-foreground truncate w-full">
                    {t('navigation.tapToView')}
                  </span>
                </button>
              )}
              {questionCount > 1 && (
                <div className="text-xs text-muted-foreground px-3">
                  {t('navigation.moreCount', { count: questionCount - 1 })}
                </div>
              )}
            </div>
          )}
        </div>
      </BottomSheetContent>
    </BottomSheet>
  )
}
