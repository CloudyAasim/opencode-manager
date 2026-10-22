import type { ReactNode } from 'react'
import { ConfirmDestructiveDialog } from '@/components/ui/confirm-destructive-dialog'
import { useI18n } from '@/lib/i18n'

interface DeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onCancel: () => void
  title: string
  description: ReactNode
  itemName?: string
  isDeleting?: boolean
  /**
   * What the confirm button says.
   *
   * It used to be worked out by looking for the word "Configuration" in the
   * title, which is a translation bug waiting to happen: the title is
   * translated, so the check only ever fired in English. The caller says what
   * it is deleting.
   */
  confirmLabel?: string
}

export function DeleteDialog({
  open,
  onOpenChange,
  onConfirm,
  onCancel,
  title,
  description,
  itemName,
  isDeleting = false,
  confirmLabel,
}: DeleteDialogProps) {
  const { t } = useI18n()

  return (
    <ConfirmDestructiveDialog
      open={open}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      onCancel={onCancel}
      title={title}
      description={description}
      warning={itemName ? t('ui.deleteDialog.warning', { itemName }) : undefined}
      confirmLabel={confirmLabel ?? t('ui.deleteDialog.delete')}
      pendingLabel={t('ui.deleteDialog.deleting')}
      isPending={isDeleting}
    />
  )
}
