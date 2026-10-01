import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

interface RestartServerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onCancel: () => void
  isRestarting?: boolean
  activeSessionCount?: number
}

export function RestartServerDialog({
  open,
  onOpenChange,
  onConfirm,
  onCancel,
  isRestarting = false,
  activeSessionCount,
}: RestartServerDialogProps) {
  const { t } = useI18n()
  const isConfirmDisabled = isRestarting

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90%] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('settingsPanels.restartServer.title')}</DialogTitle>
          <DialogDescription>
            {activeSessionCount && activeSessionCount > 0
              ? t('settingsPanels.restartServer.sessionsWorking', { count: activeSessionCount })
              : t('settingsPanels.restartServer.descriptionIdle')
            }
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={isRestarting}>
            {t('settingsPanels.restartServer.later')}
          </Button>
          <Button onClick={onConfirm} disabled={isConfirmDisabled}>
            {isRestarting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                {t('settingsPanels.restartServer.restarting')}
              </>
            ) : (
              t('settingsPanels.restartServer.restartNow')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
