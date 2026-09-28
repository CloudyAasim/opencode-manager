import type { MessageWithParts } from '../api/types'
import { useSendErrorStore } from '../stores/sendErrorStore'

const getUserMessageText = (message: MessageWithParts): string => {
  if (message.info.role !== 'user') return ''
  return message.parts
    .map((part) => (part.type === 'text' ? part.text || '' : ''))
    .join('')
    .trim()
}

const hasUserMessageText = (messages: MessageWithParts[], prompt: string): boolean => {
  const expected = prompt.trim()
  if (!expected) return false
  return messages.some((message) => getUserMessageText(message) === expected)
}

export const reconcileConfirmedPrompt = (sessionID: string, messages: MessageWithParts[]): void => {
  const sendErrorStore = useSendErrorStore.getState()
  const sendError = sendErrorStore.getError(sessionID)
  const queuedPrompt = sendErrorStore.queuedPrompts[sessionID]

  if (sendError?.kind === 'network' && sendError.failedPrompt && hasUserMessageText(messages, sendError.failedPrompt)) {
    sendErrorStore.clearNetworkError(sessionID)
  }

  if (queuedPrompt && hasUserMessageText(messages, queuedPrompt)) {
    sendErrorStore.clearQueuedPrompt(sessionID)
  }
}
