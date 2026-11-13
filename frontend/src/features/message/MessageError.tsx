import { memo } from 'react'
import { AlertCircle, KeyRound, XCircle, Clock } from 'lucide-react'
import { parseMessageError } from '@/lib/opencode-errors'
import type { MessageError as MessageErrorType } from '@opencode-manager/shared/api/v1'

interface MessageErrorProps {
  error: MessageErrorType
}

/**
 * Which face a failure gets.
 *
 * The kinds are the reasons a conversation can fail, not the classes one
 * program happens to throw, so the face is chosen from the kind.
 */
const getErrorIcon = (kind: MessageErrorType['kind']) => {
  switch (kind) {
    case 'authentication':
      return KeyRound
    case 'aborted':
      return XCircle
    case 'output-length':
      return Clock
    default:
      return AlertCircle
  }
}

export const MessageError = memo(function MessageError({ error }: MessageErrorProps) {
  const parsed = parseMessageError(error)
  if (!parsed) return null

  const Icon = getErrorIcon(error.kind)

  return (
    <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive">
      <Icon className="size-4 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{parsed.title}</div>
        <div className="text-xs text-destructive/80 mt-0.5">{parsed.message}</div>
      </div>
    </div>
  )
})
