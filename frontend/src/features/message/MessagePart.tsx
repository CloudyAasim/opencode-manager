import { memo } from 'react'
import type { components } from '@/api/opencode-types'
import { Volume2, VolumeX, Loader2 } from 'lucide-react'
import { TextPart } from './TextPart'
import { PatchPart } from './PatchPart'
import { ToolCallPart } from './ToolCallPart'
import { RetryPart } from './RetryPart'
import { useTTS } from '@/hooks/useTTS'
import { useMobile } from '@/hooks/useMobile'
import { useSettings } from '@/hooks/useSettings'
import { CopyButton } from '@/components/ui/copy-button'
import { useI18n } from '@/lib/i18n'
import { Button } from '@/components/ui/button'

type RetryPartType = components['schemas']['RetryPart']

type Part = components['schemas']['Part']

interface MessagePartProps {
  part: Part
  role?: string
  allParts?: Part[]
  partIndex?: number
  onFileClick?: (filePath: string, lineNumber?: number) => void
  onChildSessionClick?: (sessionId: string) => void
  messageTextContent?: string
}

function getCopyableContent(part: Part, allParts?: Part[]): string {
  switch (part.type) {
    case 'text':
      return part.text || ''
    case 'patch':
      return `Patch: ${part.hash}\nFiles: ${part.files.join(', ')}`
    case 'tool':
      if (part.state.status === 'completed' && part.state.input) {
        return JSON.stringify(part.state.input, null, 2)
      } else if (part.state.status === 'running' && part.state.input) {
        return JSON.stringify(part.state.input, null, 2)
      }
      return `Tool: ${part.tool} (${part.state.status})`
    case 'reasoning':
      return part.text || ''
    case 'snapshot':
      return part.snapshot || ''
    case 'agent':
      return `Agent: ${part.name}`
    case 'subtask':
      return `${part.agent}: ${part.description}\n\n${part.prompt}`.trim()
    case 'step-finish':
      if (allParts) {
        return allParts
          .filter(p => p.type === 'text')
          .map(p => p.text || '')
          .join('\n\n')
          .trim()
      }
      return ''
    case 'file':
      return part.filename || part.url || 'File'
    default:
      return ''
  }
}

interface TTSButtonProps {
  messageId: string
  content: string
  className?: string
}

function TTSButton({ messageId, content, className = "" }: TTSButtonProps) {
  const { speakMessage, stop, isEnabled, isPlaying, isLoading, activeMessageId } = useTTS()
  const { t } = useI18n()
  
  if (!isEnabled || !content.trim()) {
    return null
  }
  
  const isThisPlaying = (isPlaying || isLoading) && activeMessageId === messageId
  
  const handleClick = () => {
    if (isThisPlaying) {
      stop()
    } else {
      speakMessage(messageId, content)
    }
  }

  return (
    <Button
        variant={isThisPlaying ? 'destructive' : 'ghost'}
        size="icon-xs"
        onClick={handleClick}
        className={`${isThisPlaying ? 'text-destructive' : 'text-muted-foreground'} ${className}`}
        title={isThisPlaying ? t('message.actions.stopPlayback') : t('message.actions.readAloud')}
        disabled={isLoading && !isThisPlaying}
      >
      {isLoading && isThisPlaying ? (
        <Loader2 className="size-4 animate-spin" />
      ) : isThisPlaying ? (
        <VolumeX className="size-4" />
      ) : (
        <Volume2 className="size-4" />
      )}
    </Button>
  )
}

export const MessagePart = memo(function MessagePart({ part, role, allParts, partIndex, onFileClick, onChildSessionClick, messageTextContent }: MessagePartProps) {
  const { preferences } = useSettings()
  const simpleChatMode = preferences?.simpleChatMode ?? false
  const showReasoning = preferences?.showReasoning ?? false
  const copyableContent = getCopyableContent(part, allParts)
  const isMobile = useMobile()
  const { t } = useI18n()
  
  switch (part.type) {
    case 'text':
      if (part.synthetic) return null
      if (role === 'user' && allParts && partIndex !== undefined) {
        const nextPart = allParts[partIndex + 1]
        if (nextPart && nextPart.type === 'file') {
          return null
        }
      }
      return <TextPart part={part} />
    case 'patch':
      if (simpleChatMode) return null
      return <PatchPart part={part} onFileClick={onFileClick} />
    case 'tool':
      if (simpleChatMode && part.tool !== 'task') return null
      return <ToolCallPart part={part} onFileClick={onFileClick} onChildSessionClick={onChildSessionClick} />
    case 'reasoning':
      if (simpleChatMode || !showReasoning) return null
      return (
        <details className="border border-border rounded-lg my-2">
          <summary className="px-4 py-2 bg-muted hover:bg-accent cursor-pointer text-sm font-medium">
            {t('message.parts.reasoning')}
          </summary>
          <div className="p-4 bg-card text-sm text-muted-foreground whitespace-pre-wrap">
            {part.text}
          </div>
        </details>
      )
    case 'snapshot':
      if (simpleChatMode) return null
      return (
        <div className="border border-border rounded-lg p-4 my-2 bg-card">
          <div className="text-xs text-muted-foreground font-mono">{t('message.parts.snapshot', { snapshot: part.snapshot })}</div>
        </div>
      )
    case 'agent':
      if (simpleChatMode) return null
      return (
        <div className="border border-border rounded-lg p-4 my-2 bg-card">
          <div className="text-sm font-medium text-primary">{t('message.parts.agent', { name: part.name })}</div>
        </div>
      )
    case 'step-finish':
      if (simpleChatMode) return null
      {
        const isFree = part.cost === 0
        const totalTokens = part.tokens.input + part.tokens.output + (part.tokens.cache?.read || 0)
        const costText = isMobile && isFree ? null : <span>{t('message.parts.costTokens', { cost: part.cost.toFixed(4), tokens: totalTokens })}</span>
        return (
          <div className="text-xs text-muted-foreground my-1 flex items-center gap-2">
            {costText}
            <CopyButton content={copyableContent} title={t('message.actions.copyStepComplete')} />
            {messageTextContent && part.messageID && <TTSButton messageId={part.messageID} content={messageTextContent} />}
          </div>
        )
      }
    case 'file':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-muted border border-border text-sm text-foreground">
          <span className="text-primary">@</span>
          <span className="font-medium">{part.filename || t('message.parts.file')}</span>
        </span>
      )
    case 'retry':
      return <RetryPart part={part as RetryPartType} />
    case 'subtask': {
      const label = part.description || part.prompt || t('message.parts.subAgentTask')
      return (
        <div className="my-1 w-full rounded-lg border border-primary bg-primary px-3 py-1.5 text-left text-xs text-muted-foreground shadow-sm shadow-primary">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate">{label}</span>
            <span className="ml-auto shrink-0 text-2xs text-muted-foreground">{t('message.parts.subAgent')}</span>
          </div>
        </div>
      )
    }
    case 'step-start':
    case 'compaction':
      return null
    default:
      return null
  }
})
