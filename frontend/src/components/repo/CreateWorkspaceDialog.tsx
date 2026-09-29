import { useI18n } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Loader2, Layers, GitBranch } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface CreateWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: () => Promise<void>
  isCreating: boolean
}

export function CreateWorkspaceDialog({ open, onOpenChange, onCreate, isCreating }: CreateWorkspaceDialogProps) {
  const { t } = useI18n()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            {t('repo.createWorkspace')}
          </DialogTitle>
          <DialogDescription>
            {t('repo.createWorkspaceDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <GitBranch className="h-4 w-4 text-primary" />
            {t('repo.worktree')}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('repo.createWorkspaceHint')}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCreating}>
            {t('repo.cancel')}
          </Button>
          <Button onClick={() => { void onCreate(); }} disabled={isCreating} className="bg-primary hover:bg-primary-hover text-primary-foreground">
            {isCreating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('repo.creating')}
              </>
            ) : (
              t('repo.createWorkspace')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
