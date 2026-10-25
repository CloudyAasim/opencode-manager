import { useId, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useI18n } from '@/lib/i18n'

interface ConfirmDestructiveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onCancel: () => void
  title: string
  description: ReactNode
  warning?: ReactNode
  confirmLabel: string
  pendingLabel?: string
  cancelLabel?: string
  isPending?: boolean
}

export function ConfirmDestructiveDialog({
  open,
  onOpenChange,
  onConfirm,
  onCancel,
  title,
  description,
  warning,
  confirmLabel,
  pendingLabel,
  cancelLabel,
  isPending = false,
}: ConfirmDestructiveDialogProps) {
  const { t } = useI18n()
  const resolvedCancelLabel = cancelLabel ?? t('ui.confirmDestructiveDialog.cancel')
  // The dialog content turns the automatic description wiring off, so the
  // text that says what is about to happen was never announced. A screen
  // reader user could open "Delete project" and hear nothing about what
  // deletion means.
  const descriptionId = useId()
  const warningId = useId()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[90%] sm:max-w-sm"
        aria-describedby={warning ? `${descriptionId} ${warningId}` : descriptionId}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription id={descriptionId}>{description}</DialogDescription>
        </DialogHeader>

        {warning && (
          <Alert id={warningId} className="overflow-hidden">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <AlertDescription className="break-all">{warning}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button
            size="touch" variant="outline"
            onClick={onCancel}
            disabled={isPending}
            className="flex-1 sm:flex-none"
          >
            {resolvedCancelLabel}
          </Button>
          <Button
            size="touch" variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 sm:flex-none font-semibold"
          >
            {isPending && pendingLabel ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
