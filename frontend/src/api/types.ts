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
 *
 * What the agent is waiting for is the same story: the client asks for the
 * permissions and questions it has to answer over HTTP and watches them
 * change over the stream, so both answers are the versioned ones and the
 * client never has to learn a second dialect to watch the thing it already
 * learned one dialect for.
 */
export type Message = VersionedMessage
export type Part = VersionedPart
export type Session = VersionedSession
export type PermissionResponse = VersionedPermissionResponse

export type MessageWithParts = VersionedMessageWithParts

export type MessageListResponse = MessageWithParts[]

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
 * conversation itself is read in, and that includes how busy it is and what
 * the agent is waiting for, because the client is told about those over the
 * stream and asks for them over HTTP. The rest are the agent's, because they
 * are not about the conversation: which version of the program is running.
 *
 * The directory is not part of the event but part of the envelope the event
 * travels in, so it is added here: the stream says where an event came from,
 * and a client that has to know that would otherwise have to dig it out of
 * the frame.
 */
export type SSEEvent =
  | (ConversationEvent & { directory?: string })
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
