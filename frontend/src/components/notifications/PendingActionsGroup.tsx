import { Bell, HelpCircle } from 'lucide-react'
import { PendingActionBadge } from '@/components/ui/pending-action-badge'
import { usePermissions, useQuestions } from '@/contexts/EventContext'
import { useI18n } from '@/lib/i18n'

export function PendingActionsGroup() {
  const { t } = useI18n()
  const { pendingCount: permissionCount, setShowDialog, navigateToCurrent: navigateToPermission } = usePermissions()
  const { pendingCount: questionCount, navigateToCurrent } = useQuestions()

  return (
    <>
      <PendingActionBadge
        count={permissionCount}
        icon={Bell}
        color="orange"
        onClick={() => {
          navigateToPermission()
          setShowDialog(true)
        }}
        label={t('misc.notifications.pendingPermission')}
      />
      <PendingActionBadge
        count={questionCount}
        icon={HelpCircle}
        color="blue"
        onClick={navigateToCurrent}
        label={t('misc.notifications.pendingQuestion')}
      />
    </>
  )
}
