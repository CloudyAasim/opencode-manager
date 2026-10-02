import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RepoLspServerList } from './RepoLspServerList'
import { useLSPStatus } from '@/hooks/useLSPStatus'
import { useI18n } from '@/lib/i18n'

interface RepoLspDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  opcodeUrl: string | null | undefined
  directory?: string
}

export function RepoLspDialog({ open, onOpenChange, opcodeUrl, directory }: RepoLspDialogProps) {
  const { t } = useI18n()
  const { isLoading, data } = useLSPStatus(opcodeUrl, directory, { enabled: open })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] w-full">
        <DialogHeader>
          <DialogTitle>{t('repo.lsp.title')}</DialogTitle>
        </DialogHeader>
        <RepoLspServerList isLoading={isLoading} data={data} />
      </DialogContent>
    </Dialog>
  )
}
