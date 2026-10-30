import { memo } from 'react'
import { X, Loader2 } from 'lucide-react'
import { useUndoMessage } from '@/hooks/useUndoMessage'
import { useMobile } from '@/hooks/useMobile'
import { useI18n } from '@/lib/i18n'
import { Button } from '@/components/ui/button'

interface UserMessageActionButtonsProps {
  opcodeUrl: string
  sessionId: string
  directory?: string
  userMessageId: string
  userMessageContent: string
  onUndo: (restoredPrompt: string) => void
}

export const UserMessageActionButtons = memo(function UserMessageActionButtons({
  opcodeUrl,
  sessionId,
  directory,
  userMessageId,
  userMessageContent,
  onUndo
}: UserMessageActionButtonsProps) {
  const isMobile = useMobile()
  const { t } = useI18n()
  const undoMessage = useUndoMessage({ 
    opcodeUrl, 
    sessionId, 
    directory,
    onSuccess: onUndo
  })

  const handleUndo = () => {
    if (undoMessage.isPending) return
    undoMessage.mutate({ 
      messageID: userMessageId, 
      messageContent: userMessageContent 
    })
  }

  return (
    <div className={`flex items-center gap-1 ${isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
      <Button
        variant="ghost-destructive"
        size="icon-2xs"
        onClick={handleUndo}
        disabled={undoMessage.isPending}
        className="text-muted-foreground"
        title={t('message.actions.undoThisMessage')}
      >
        {undoMessage.isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <X className="size-3.5" />
        )}
      </Button>
    </div>
  )
})
