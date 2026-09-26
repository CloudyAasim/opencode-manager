import { ConfirmDestructiveDialog } from '@/components/ui/confirm-destructive-dialog'
import { useI18n } from '@/lib/i18n'

interface UnsavedChangesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDiscard: () => void
  onKeepEditing: () => void
  itemName?: string
}

export function UnsavedChangesDialog({
  open,
  onOpenChange,
  onDiscard,
  onKeepEditing,
  itemName,
}: UnsavedChangesDialogProps) {
  const { t } = useI18n()
  return (
    <ConfirmDestructiveDialog
      open={open}
      onOpenChange={onOpenChange}
      onConfirm={onDiscard}
      onCancel={onKeepEditing}
      title={t('ui.unsavedChangesDialog.title')}
      description={itemName ? t('ui.unsavedChangesDialog.descriptionWithItem', { itemName }) : t('ui.unsavedChangesDialog.description')}
      warning={t('ui.unsavedChangesDialog.warning')}
      confirmLabel={t('ui.unsavedChangesDialog.discard')}
      cancelLabel={t('ui.unsavedChangesDialog.keepEditing')}
    />
  )
}
