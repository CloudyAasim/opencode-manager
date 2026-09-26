import { ConfirmDestructiveDialog } from '@/components/ui/confirm-destructive-dialog'
import { useI18n } from '@/lib/i18n'

interface DiscardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onCancel: () => void
  fileCount: number
  isDiscarding?: boolean
}

export function DiscardDialog({
  open,
  onOpenChange,
  onConfirm,
  onCancel,
  fileCount,
  isDiscarding = false
}: DiscardDialogProps) {
  const { t } = useI18n()
  const itemText = t('ui.discardDialog.fileCount', { count: fileCount })

  return (
    <ConfirmDestructiveDialog
      open={open}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      onCancel={onCancel}
      title={t('ui.discardDialog.title')}
      description={t('ui.discardDialog.description', { itemText })}
      warning={t('ui.discardDialog.warning', { itemText })}
      confirmLabel={t('ui.discardDialog.confirm')}
      pendingLabel={t('ui.discardDialog.pending')}
      isPending={isDiscarding}
    />
  )
}
