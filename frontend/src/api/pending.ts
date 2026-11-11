import type { PendingPermission, PendingQuestion } from '@opencode-manager/shared/api/v1'
import type { PermissionRequest, QuestionRequest } from './types'

/**
 * The two dialects of a pending request, and the one the app keeps.
 *
 * The event stream is the agent's own events, relayed, so it speaks the
 * agent's dialect. The list comes from the layer the client talks to, and it
 * speaks the versioned dialect. The app keeps the versioned one - otherwise
 * the same permission exists in the app in two shapes, and the code that
 * reads it has to know which one it is holding.
 *
 * This is the one place where the agent's dialect stops.
 */

/** The agent's dialect, as the event stream delivers it. */
type AgentPermission = PermissionRequest
type AgentQuestion = QuestionRequest

export function toPendingPermission(
  raw: AgentPermission,
  directory?: string | null,
): PendingPermission {
  return {
    id: raw.id,
    sessionId: raw.sessionID,
    directory: directory ?? null,
    permission: raw.permission,
    patterns: raw.patterns ?? [],
    metadata: raw.metadata ?? {},
    always: raw.always ?? [],
    tool: raw.tool ? { messageId: raw.tool.messageID, callId: raw.tool.callID } : null,
  }
}

export function toPendingQuestion(
  raw: AgentQuestion,
  directory?: string | null,
): PendingQuestion {
  return {
    id: raw.id,
    sessionId: raw.sessionID,
    directory: directory ?? null,
    questions: (raw.questions ?? []).map((question) => ({
      question: question.question,
      header: question.header,
      options: (question.options ?? []).map((option) => ({
        label: option.label,
        description: option.description ?? null,
      })),
      multiple: question.multiple ?? false,
    })),
    tool: raw.tool ? { messageId: raw.tool.messageID, callId: raw.tool.callID } : null,
  }
}
