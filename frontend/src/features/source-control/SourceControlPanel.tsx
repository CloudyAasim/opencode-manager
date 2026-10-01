import { GitBranch, X } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useMobile } from '@/hooks/useMobile'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { SourceControlContent } from './SourceControlContent'

interface SourceControlPanelProps {
  repoId: number
  isOpen: boolean
  onClose: () => void
  currentBranch: string
  repoName?: string
}

export function SourceControlPanel({
  repoId,
  isOpen,
  onClose,
  currentBranch,
  repoName,
}: SourceControlPanelProps) {
  const { t } = useI18n()
  const isMobile = useMobile()

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        mobileFullscreen
        hideCloseButton={isMobile}
        className={cn(
          'p-0 flex flex-col bg-card border-border gap-0',
          isMobile ? 'h-full' : 'w-[90vw] sm:max-w-6xl h-[90vh] sm:pb-0'
        )}
      >
        <DialogHeader className={cn('px-4 py-2 border-b border-border flex-shrink-0', isMobile && 'relative')}>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="w-5 h-5" />
            {isMobile && repoName ? repoName : t('misc.sourceControl.title')}
          </DialogTitle>
          {isMobile && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 p-0"
            >
              <X className="h-6 w-6" />
            </Button>
          )}
        </DialogHeader>
        <div className="flex-1 overflow-hidden pb-0">
          <SourceControlContent
            repoId={repoId}
            currentBranch={currentBranch}
            isMobile={isMobile}
            active={isOpen}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
