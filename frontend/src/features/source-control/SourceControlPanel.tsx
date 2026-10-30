import { GitBranch, X } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { DialogTitleBar } from '@/components/ui/dialog-layout'
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
        variant="solid"
        width="6xl"
        className={cn(
          'flex flex-col gap-0',
          isMobile ? 'h-full' : 'w-[90vw]  h-[90vh] sm:pb-0'
        )}
      >
        <DialogTitleBar
          title={
            <>
              <GitBranch className="size-5" />
              {isMobile && repoName ? repoName : t('misc.sourceControl.title')}
            </>
          }
          titleClassName="flex items-center gap-2"
          className={cn(isMobile && 'relative')}
        >
          {isMobile && (
            <Button
              variant="ghost"
              size="icon-lg"
              onClick={onClose}
              className="absolute right-2 top-1/2 -translate-y-1/2"
            >
              <X className="size-6" />
            </Button>
          )}
        </DialogTitleBar>
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
