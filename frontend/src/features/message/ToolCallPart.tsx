import { useState, useRef, useEffect, useMemo, memo } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { useUserBash } from '@/stores/userBashStore'
import { useSessionStatusForSession } from '@/stores/sessionStatusStore'
import { usePermissions, useQuestions } from '@/contexts/EventContext'
import { detectFileReferences } from '@/lib/fileReferences'
import { ExternalLink, Loader2 } from 'lucide-react'
import { CopyButton } from '@/components/ui/copy-button'
import { getToolSpecificRender } from './FileToolRender'
import { useI18n } from '@/lib/i18n'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { Part } from '@/api/types'

type ToolPart = Extract<Part, { type: 'tool' }>

const DISPLAY_LIMIT = 30_000
const DISPLAY_HEAD_LENGTH = 20_000
const DISPLAY_TAIL_LENGTH = 10_000

function formatOmittedSize(size: number): string {
  return size < 1024 * 1024
    ? `${(size / 1024).toFixed(1)} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function clampDisplayText(text: string, buildMarker: (omitted: string) => string): string {
  if (text.length <= DISPLAY_LIMIT) return text
  const headCut = text.lastIndexOf('\n', DISPLAY_HEAD_LENGTH)
  const head = headCut === -1 ? text.slice(0, DISPLAY_HEAD_LENGTH) : text.slice(0, headCut)
  const tailFrom = text.length - DISPLAY_TAIL_LENGTH
  const tailCut = text.indexOf('\n', tailFrom)
  const tail = tailCut === -1 ? text.slice(tailFrom) : text.slice(tailCut + 1)
  const omitted = formatOmittedSize(text.length - head.length - tail.length)
  return head + buildMarker(omitted) + tail
}

function BoundedPre({ content, className }: { content: string; className: string }) {
  const { t } = useI18n()
  const clamped = useMemo(
    () => clampDisplayText(content, (size) => `\n[… ${t('message.tools.omittedMarker', { size })} …]\n`),
    [content, t]
  )
  return <pre className={className}>{clamped}</pre>
}

interface ToolCallPartProps {
  part: ToolPart
  /**
   * The conversation the call was made in.
   *
   * A call does not say this about itself any more - the pieces of a message
   * are the message's, and the message is what says which conversation it is
   * in - so the thread hands it down. The waiting room is keyed by it.
   */
  sessionId?: string
  onFileClick?: (filePath: string, lineNumber?: number) => void
  onChildSessionClick?: (sessionId: string) => void
  simpleChatMode?: boolean
}

/**
 * The conversation the sub-agent went off into, if the agent said so.
 *
 * It is said in the call's own metadata, because that is the call's business
 * and not the conversation's: who the call was made for is the agent's own
 * bookkeeping.
 */
function getTaskSessionId(part: ToolPart): string | undefined {
  if (part.state.status === 'pending') return undefined
  const sessionId = part.state.metadata?.sessionId
  return typeof sessionId === 'string' ? sessionId : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * How long the call took, when it took long enough to say.
 *
 * A call that has not finished has a beginning and no end yet, and there is
 * no duration to report for one.
 */
function durationOf(time: { start: number; end: number | null } | null): number | null {
  if (!time || time.end === null) return null
  return (time.end - time.start) / 1000
}

function ClickableJson({ json, onFileClick }: { json: unknown; onFileClick?: (filePath: string) => void }) {
  const { t } = useI18n()
  const jsonString = useMemo(() => JSON.stringify(json, null, 2), [json])
  const references = useMemo(() => detectFileReferences(jsonString), [jsonString])

  if (references.length === 0) {
    return <pre className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words">{jsonString}</pre>
  }

  const parts: React.ReactNode[] = []
  let lastIndex = 0

  references.forEach((ref, index) => {
    if (ref.startIndex > lastIndex) {
      parts.push(jsonString.slice(lastIndex, ref.startIndex))
    }

    parts.push(
      <span
        key={`ref-${index}`}
        onClick={(e) => {
          e.stopPropagation()
          onFileClick?.(ref.filePath)
        }}
        className="text-primary hover:text-primary dark:hover:text-primary cursor-pointer underline decoration-dotted"
        title={t('message.parts.clickToOpen', { path: ref.filePath })}
      >
        {ref.fullMatch}
      </span>
    )

    lastIndex = ref.endIndex
  })

  if (lastIndex < jsonString.length) {
    parts.push(jsonString.slice(lastIndex))
  }

  return <pre className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words">{parts}</pre>
}

export const ToolCallPart = memo(function ToolCallPart({ part, sessionId, onFileClick, onChildSessionClick }: ToolCallPartProps) {
  const { preferences } = useSettings()
  const { t } = useI18n()
  const { userBashCommands } = useUserBash()
  const taskSessionId = part.name === 'task' ? getTaskSessionId(part) : undefined
  const taskSessionStatus = useSessionStatusForSession(taskSessionId)
  const { getForCallID: getPermissionForCallID } = usePermissions()
  const { getForCallID: getQuestionForCallID } = useQuestions()
  const outputRef = useRef<HTMLDivElement>(null)
  const command = part.state.input?.command
  const rawCommand = part.name === 'bash' && typeof command === 'string' ? command : undefined
  const displayCommand = rawCommand
  const isUserBashCommand = part.state.status === 'completed' &&
    typeof displayCommand === 'string' &&
    userBashCommands.has(displayCommand)
  const isTodoTool = part.name === 'todowrite' || part.name === 'todoread'
  const defaultExpanded = isUserBashCommand || isTodoTool || (preferences?.expandToolCalls ?? false)
  const [userToggled, setUserToggled] = useState<boolean | null>(null)
  const expanded = userToggled ?? defaultExpanded
  const setExpanded = (next: boolean) => setUserToggled(next)

  const pendingPermission = getPermissionForCallID(part.callId, sessionId ?? '')
  const isWaitingPermission = part.state.status === 'running' && !!pendingPermission
  const pendingQuestion = getQuestionForCallID(part.callId, sessionId ?? '')
  const isWaitingQuestion = part.state.status === 'running' && !!pendingQuestion

  useEffect(() => {
    if (part.name === 'bash' && expanded && outputRef.current) {
      outputRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [expanded, part.name])

  const getStatusColor = () => {
    switch (part.state.status) {
      case 'completed':
        return 'text-success'
      case 'error':
        return 'text-destructive'
      case 'running':
        if (isWaitingPermission) return 'text-primary'
        if (isWaitingQuestion) return 'text-primary'
        return 'text-warning'
      default:
        return 'text-muted-foreground'
    }
  }

  const getStatusIcon = () => {
    switch (part.state.status) {
      case 'completed':
        return <span>✓</span>
      case 'error':
        return <span>✗</span>
      case 'running':
        return <Loader2 className="size-3.5 animate-spin" />
      case 'pending':
        return <span className="inline-block w-2 h-2 rounded-full bg-current animate-pulse" />
      default:
        return <span>○</span>
    }
  }

  const getPreviewText = () => {
    if (part.state.status === 'pending') return null

    const input = part.state.input
    if (!input) return null

    switch (part.name) {
      case 'read':
      case 'write':
      case 'edit':
        return asString(input.filePath) || null
      case 'bash':
        return displayCommand || null
      case 'glob':
        return asString(input.pattern) || null
      case 'grep':
        return asString(input.pattern) || null
      case 'list':
        return asString(input.path) || '.'
      case 'task':
        return asString(input.description) || null
      case 'todowrite':
      case 'todoread':
        return null
      default:
        return null
    }
  }

  const previewText = getPreviewText()
  const duration = durationOf(part.state.time)
  const isFileTool = ['read', 'write', 'edit'].includes(part.name)

  if (part.name === 'task') {
    const sessionId = taskSessionId
    const description = previewText || t('message.parts.subAgentTask')
    const status = part.state.status

    const isPending = status === 'pending'
    const isRunning = status === 'running' && taskSessionStatus.type !== 'idle'
    const isCompleted = status === 'completed' || (status === 'running' && !!sessionId && taskSessionStatus.type === 'idle')
    const isError = status === 'error'

    const content = (
      <div className="flex items-center gap-2 min-w-0">
        {isPending && (
          <div className="flex gap-1">
            <span className="w-2 h-2 rounded-full bg-muted-foreground" />
            <span className="w-2 h-2 rounded-full bg-muted-foreground" />
            <span className="w-2 h-2 rounded-full bg-muted-foreground" />
          </div>
        )}
        {isRunning && (
          <div className="flex gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2.5 h-2.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2.5 h-2.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        )}
        {isCompleted && <span className="text-success text-sm font-medium">✓</span>}
        {isError && <span className="text-destructive text-sm font-medium">✗</span>}
        <span className="font-medium text-foreground truncate">{description}</span>
        <span className="text-2xs font-medium text-primary shrink-0">{t('message.parts.subAgent')}</span>
        {sessionId && <ExternalLink className="size-3 shrink-0 text-primary" />}
      </div>
    )

    if (sessionId) {
      return (
        <Button
          variant="default"
          size="xs"
          onClick={() => onChildSessionClick?.(sessionId)}
          className="my-1 w-full justify-start"
          title={t('message.actions.viewSubagentSession')}
        >
          {content}
        </Button>
      )
    }

    return (
      <div className="my-1 rounded-lg border border-primary bg-primary px-3 py-1.5 text-xs text-muted-foreground shadow-sm shadow-primary">
        {content}
      </div>
    )
  }

  if (isTodoTool) {
    if (part.state.status === 'error') {
      return (
        <div className="my-2 text-sm text-destructive">
          {t('message.todos.updateError', { error: part.state.error })}
        </div>
      )
    }

    return null
  }

  const toolSpecificRender = getToolSpecificRender(part, onFileClick)
  if (toolSpecificRender) {
    return toolSpecificRender
  }

  if (isUserBashCommand) {
    const command = displayCommand ?? ''
    const output = part.state.status === 'completed' ? part.state.output : ''
    return (
      <div className="my-2">
        <div className="flex items-center gap-2 text-sm mb-2">
          <span className="text-success">✓</span>
          <span className="font-medium">$</span>
          <span className="text-foreground">{command}</span>
          {part.state.status === 'completed' && duration !== null && (
            <span className="text-muted-foreground text-xs ml-auto">
              {duration.toFixed(2)}s
            </span>
          )}
        </div>
        <div className="relative">
          <BoundedPre content={output ?? ''} className="bg-accent p-3 rounded text-xs overflow-x-auto whitespace-pre-wrap" />
          <CopyButton content={output ?? ''} title={t('message.actions.copyOutput')} className="absolute top-2 right-2" />
        </div>
      </div>
    )
  }

  const getBorderStyle = () => {
    switch (part.state.status) {
      case 'running':
        if (isWaitingPermission) return 'border-warning shadow-sm shadow-warning'
        if (isWaitingQuestion) return 'border-primary shadow-sm shadow-primary'
        return 'border-warning shadow-sm shadow-warning'
      case 'pending':
        return 'border-primary'
      case 'error':
        return 'border-destructive'
      case 'completed':
        return 'border-border'
      default:
        return 'border-border'
    }
  }

  return (
    <div ref={outputRef} className={`border rounded-lg overflow-hidden my-2 transition-all ${getBorderStyle()}`}>
      <Card
        asChild
        variant="flat"
        clickable
        onClick={() => setExpanded(!expanded)}
        className="px-4 py-2 items-center gap-2 min-w-0"
      >
        <button type="button">
        <span className={getStatusColor()}>{getStatusIcon()}</span>
        <span className="font-medium">{part.name}</span>

        {previewText && isFileTool ? (
          <span
            onClick={(e) => {
              e.stopPropagation()
              if (onFileClick && previewText) {
                onFileClick(previewText)
              }
            }}
            className="text-primary text-xs truncate hover:text-primary dark:hover:text-primary cursor-pointer underline decoration-dotted"
            title={t('message.parts.clickToOpen', { path: previewText })}
          >
            {previewText}
          </span>
        ) : previewText ? (
          <span className="text-muted-foreground text-xs truncate">{previewText}</span>
        ) : null}

        {part.name === 'task' && (() => {
          const childSessionId = getTaskSessionId(part)
          return childSessionId ? (
            <span
              onClick={(e) => {
                e.stopPropagation()
                onChildSessionClick?.(childSessionId)
              }}
              className="text-primary text-xs hover:text-primary dark:hover:text-primary cursor-pointer underline decoration-dotted flex items-center gap-1"
              title={t('message.actions.viewSubagentSession')}
            >
              <ExternalLink className="size-3" />
              {t('message.actions.viewSession')}
            </span>
          ) : null
        })()}
         <span className="text-muted-foreground text-xs ml-auto">({isWaitingPermission ? t('message.tools.awaitingPermission') : isWaitingQuestion ? t('message.tools.awaitingAnswer') : part.state.status})</span>
        </button>
      </Card>

      {expanded && (
        <div className="bg-card space-y-2 p-3">
          {part.state.status === 'pending' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="flex gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span>{t('message.tools.preparing')}</span>
            </div>
          )}

          {part.state.status === 'running' && (
            <>
              {part.name === 'bash' ? (
                <div className="text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="text-muted-foreground">{t('message.tools.command')}</div>
                    <CopyButton
                      content={displayCommand ?? ''}
                      title={t('message.actions.copyCommand')}
                    />
                  </div>
                  <div className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words">
                    <span className="text-success">$</span> {displayCommand ?? ''}
                  </div>
                  <div className={`flex items-center gap-2 mt-2 text-xs ${isWaitingPermission ? 'text-primary' : 'text-warning'}`}>
                    <Loader2 className="size-3 animate-spin" />
                    <span>{isWaitingPermission ? t('message.tools.waitingPermission') : t('message.tools.running')}</span>
                  </div>
                </div>
              ) : (
                <div className="text-sm">
                  <div className="text-muted-foreground mb-1">{t('message.tools.input')}</div>
                  <ClickableJson json={part.state.input} onFileClick={onFileClick} />
                  <div className={`flex items-center gap-2 mt-2 text-xs ${isWaitingPermission ? 'text-primary' : 'text-warning'}`}>
                    <Loader2 className="size-3 animate-spin" />
                    <span>{isWaitingPermission ? t('message.tools.waitingPermission') : t('message.tools.running')}</span>
                  </div>
                </div>
              )}
            </>
          )}

          {part.state.status === 'completed' && (
            <>
              {part.name === 'bash' ? (
                <div className="text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="text-muted-foreground">{t('message.tools.command')}</div>
                    <CopyButton
                      content={displayCommand ?? ''}
                      title={t('message.actions.copyCommand')}
                    />
                  </div>
                  <div className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words">
                    <span className="text-success">$</span> {displayCommand ?? ''}
                  </div>
                </div>
              ) : (
                <div className="text-sm">
                  <div className="text-muted-foreground mb-1">{t('message.tools.input')}</div>
                  <ClickableJson json={part.state.input} onFileClick={onFileClick} />
                </div>
              )}
              <div className="text-sm">
                <div className="text-muted-foreground mb-1">{t('message.tools.output')}</div>
                <div className="relative">
                  <BoundedPre
                    content={part.state.status === 'completed' ? part.state.output ?? '' : ''}
                    className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-all"
                  />
                  {part.state.status === 'completed' && part.state.output && (
                    <CopyButton content={part.state.output} title={t('message.actions.copyOutput')} className="absolute top-1 right-1" iconSize="sm" />
                  )}
                </div>
              </div>
              {duration !== null && (
                <div className="text-xs text-muted-foreground">
                  {t('message.tools.duration', { seconds: duration.toFixed(2) })}
                </div>
              )}
            </>
          )}

          {part.state.status === 'error' && (
            <div className="text-sm">
              <div className="text-destructive mb-1">{t('message.tools.error')}</div>
              <BoundedPre
                content={part.state.error ?? ''}
                className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words text-destructive"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
})
