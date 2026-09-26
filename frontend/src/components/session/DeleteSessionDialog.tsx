import { DeleteDialog } from '@/components/ui/delete-dialog'
import { useI18n } from '@/lib/i18n'

interface DeleteSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onCancel: () => void
  isDeleting?: boolean
  sessionCount?: number
}

export function DeleteSessionDialog({ open, onOpenChange, onConfirm, onCancel, isDeleting = false, sessionCount = 1 }: DeleteSessionDialogProps) {
  const { t } = useI18n()
  const isMultiple = sessionCount > 1
  const title = isMultiple ? t('session.deleteDialog.multipleTitle') : t('session.deleteDialog.singleTitle')
  const description = isMultiple
    ? <>{t('session.deleteDialog.multipleDescriptionBefore')}<span className="text-destructive font-bold text-lg">{sessionCount}</span>{t('session.deleteDialog.multipleDescriptionAfter')}</>
    : t('session.deleteDialog.singleDescription')

  return (
    <DeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      onCancel={onCancel}
      title={title}
      description={description}
      isDeleting={isDeleting}
    />
  )
}
