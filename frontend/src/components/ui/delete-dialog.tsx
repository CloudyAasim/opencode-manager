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
}

export function DeleteDialog({
  open,
  onOpenChange,
  onConfirm,
  onCancel,
  title,
  description,
  itemName,
  isDeleting = false
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
      confirmLabel={title.includes('Configuration') ? t('ui.deleteDialog.deleteConfiguration') : t('ui.deleteDialog.delete')}
      pendingLabel={t('ui.deleteDialog.deleting')}
      isPending={isDeleting}
    />
  )
}
