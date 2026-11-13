export interface Repo {
  id: number
  name?: string
  repoUrl?: string
  localPath: string
  fullPath: string
  sourcePath?: string
  branch?: string
  currentBranch?: string
  defaultBranch: string
  cloneStatus: 'cloning' | 'ready' | 'error'
  clonedAt: number
  lastPulled?: number
  lastAccessedAt?: number
  gitCredentialId?: string
  isWorktree?: boolean
  isLocal?: boolean
  /**
   * Whether the checkout directory is on disk right now. Absent means the
   * server did not check (older backend), not that the directory is missing -
   * so only `false` may be treated as proof.
   */
  directoryExists?: boolean
}

import type { components } from './opencode-types'
import type {
  ConversationEvent,
  Message as VersionedMessage,
  MessagePart as VersionedPart,
  MessageWithParts as VersionedMessageWithParts,
  PermissionResponse as VersionedPermissionResponse,
  Session as VersionedSession,
} from '@opencode-manager/shared/api/v1'

/**
 * The conversation's own shapes.
 *
 * A conversation is read over HTTP and watched over the event stream, and it
 * is the same conversation in both. So the shapes are the versioned API's -
 * one truth about what a message is - and the client holds one dialect, not
 * two: the one it reads and the one it is told about.
 */
export type Message = VersionedMessage
export type Part = VersionedPart
export type Session = VersionedSession
export type PermissionRequest = components['schemas']['PermissionRequest']
export type PermissionResponse = VersionedPermissionResponse

export type QuestionOption = components['schemas']['QuestionOption']
export type QuestionInfo = components['schemas']['QuestionInfo']
export type QuestionRequest = components['schemas']['QuestionRequest']
export type QuestionAnswer = components['schemas']['QuestionAnswer']

export type MessageWithParts = VersionedMessageWithParts

export type MessageListResponse = MessageWithParts[]

export interface SSETodoUpdatedEvent {
  type: 'todo.updated'
  properties: {
    sessionID: string
    todos: components['schemas']['Todo'][]
  }
}

export interface SSEPermissionAskedEvent {
  type: 'permission.asked'
  properties: PermissionRequest
  directory?: string
}

export interface SSEPermissionRepliedEvent {
  type: 'permission.replied'
  properties: {
    sessionID: string
    permissionID: string
    response: string
  }
}

export interface SSEQuestionAskedEvent {
  type: 'question.asked'
  properties: QuestionRequest
  directory?: string
}

export interface SSEQuestionRepliedEvent {
  type: 'question.replied'
  properties: {
    sessionID: string
    requestID: string
    answers: QuestionAnswer[]
  }
}

export interface SSEQuestionRejectedEvent {
  type: 'question.rejected'
  properties: {
    sessionID: string
    requestID: string
  }
}

export interface SSEInstallationUpdatedEvent {
  type: 'installation.updated'
  properties: {
    version: string
  }
}

export interface SSEInstallationUpdateAvailableEvent {
  type: 'installation.update-available'
  properties: {
    version: string
  }
}

export interface SSELspUpdatedEvent {
  type: 'lsp.updated'
  properties: Record<string, never>
}

export interface SSEVcsBranchUpdatedEvent {
  type: 'vcs.branch.updated'
  directory?: string
  properties: {
    branch?: string
  }
}

export interface SSESSHHostKeyRequestEvent {
  type: 'ssh.host-key-request'
  properties: SSHHostKeyRequest
}

/**
 * Everything the stream can say.
 *
 * The conversation's own events are the versioned API's - the same words the
 * conversation itself is read in, and that includes how busy it is, because
 * the client is told about that over the stream and asks for it over HTTP.
 * The rest are the agent's, because they are not about the conversation:
 * what it is waiting for, which version of the program is running.
 */
export type SSEEvent =
  | ConversationEvent
  | SSETodoUpdatedEvent
  | SSEPermissionAskedEvent
  | SSEPermissionRepliedEvent
  | SSEQuestionAskedEvent
  | SSEQuestionRepliedEvent
  | SSEQuestionRejectedEvent
  | SSEInstallationUpdatedEvent
  | SSEInstallationUpdateAvailableEvent
  | SSELspUpdatedEvent
  | SSEVcsBranchUpdatedEvent
  | SSESSHHostKeyRequestEvent

export type ContentPart = 
  | { type: 'text', content: string }
  | { type: 'file', path: string, name: string }
  | { type: 'image', id: string, filename: string, mime: string, dataUrl: string }

export interface FileAttachmentInfo {
  path: string
  name: string
  mime?: string
}

export interface ImageAttachment {
  id: string
  filename: string
  mime: string
  dataUrl: string
}

export interface SSHHostKeyRequest {
  id: string
  requestId: string
  host: string
  ip?: string
  keyType: string
  fingerprint: string
  isKeyChanged?: boolean
  timestamp: number
  action: 'verify'
}
