import type {
  MessageWithParts,
  PendingPermission,
  PendingQuestion,
  SendPromptRequest,
  Session,
  SessionRevert,
} from '@opencode-manager/shared/api/v1'
import { fetchWrapper } from './fetchWrapper'

/**
 * Where the session list lives.
 *
 * Written out in full, because this is the address the client talks to for
 * its list: the layer the client talks to, not the agent behind it.
 */
export const BFF_SESSIONS_ENDPOINT = '/api/bff/sessions'

/**
 * Where the pending requests live.
 *
 * The same layer, the same rule: the client asks it, and it asks the agent.
 */
export const BFF_PENDING_ENDPOINT = '/api/bff/pending'

/**
 * The layer the client talks to for its session list.
 *
 * The client used to ask the agent directly and merge the answers itself:
 * one request per working directory, one cursor per directory, and the
 * merging done in the browser. That is a server's job, so it moved here.
 */
export interface BffSessionListResponse {
  sessions: Session[]
  /** Where the next page of each directory starts. */
  cursors: Record<string, string>
}

export interface BffSessionListOptions {
  /** How many sessions to ask for, per directory. */
  limit?: number
  search?: string
  /** The cursors from a previous answer. */
  cursors?: Record<string, string>
}

/**
 * What the agent is waiting for, across the named directories.
 */
export interface BffPendingResponse {
  permissions: PendingPermission[]
  questions: PendingQuestion[]
}

/**
 * One conversation, as the layer answers about it.
 *
 * A `Session` is the versioned API's `Session` - there is one truth about
 * what a session is. What this layer adds is the part that is its own: the
 * client does not have to say where the conversation lives.
 */
export interface BffSessionResponse {
  session: Session
}

/** A conversation that is gone. */
export interface BffDeletedResponse {
  deleted: true
  id: string
}

/** Something the agent has taken on. */
export interface BffAcceptedResponse {
  accepted: true
}

/**
 * What was said in one conversation.
 *
 * The messages are the versioned API's messages - there is one truth about
 * what a message is - and what this layer adds is that the client does not
 * have to know which agent is behind the conversation or which working
 * directory it lives in.
 */
export interface BffMessageListResponse {
  messages: MessageWithParts[]
}

export class BffClient {
  /** The address of the server this layer is on. */
  private baseURL: string

  constructor(baseURL: string) {
    this.baseURL = baseURL
  }

  async listSessions(
    directories: string[],
    options: BffSessionListOptions = {},
  ): Promise<BffSessionListResponse> {
    const params = new URLSearchParams()
    for (const directory of directories) {
      params.append('directories', directory)
    }
    if (options.limit !== undefined) params.set('limit', String(options.limit))
    if (options.search) params.set('search', options.search)
    if (options.cursors && Object.keys(options.cursors).length > 0) {
      params.set('cursors', JSON.stringify(options.cursors))
    }
    return fetchWrapper<BffSessionListResponse>(
      `${this.baseURL}${BFF_SESSIONS_ENDPOINT}?${params.toString()}`,
    )
  }

  /**
   * What the agent is waiting for, across the named directories.
   *
   * One request for every directory, the way the session list is one
   * request for every directory.
   */
  async listPending(directories: string[]): Promise<BffPendingResponse> {
    const params = new URLSearchParams()
    for (const directory of directories) {
      params.append('directories', directory)
    }
    return fetchWrapper<BffPendingResponse>(
      `${this.baseURL}${BFF_PENDING_ENDPOINT}?${params.toString()}`,
    )
  }

  /**
   * One conversation.
   *
   * The client names the conversation and, at most, the working directories
   * it works in. The layer works out where the conversation lives - the
   * ledger knows, or the agent knows, or the caller's own directories know -
   * so the client does not have to keep a map of conversations to
   * directories, which was one more thing for it to get wrong.
   */
  async getSession(sessionId: string, directories: string[] = []): Promise<BffSessionResponse> {
    return fetchWrapper<BffSessionResponse>(this.sessionUrl(sessionId, directories))
  }

  /**
   * A new conversation, in a named working directory.
   */
  async createSession(input: { title?: string; directory: string }): Promise<BffSessionResponse> {
    return fetchWrapper<BffSessionResponse>(`${this.baseURL}${BFF_SESSIONS_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  }

  /**
   * A conversation's new title.
   */
  async renameSession(
    sessionId: string,
    title: string,
    directories: string[] = [],
  ): Promise<BffSessionResponse> {
    return fetchWrapper<BffSessionResponse>(this.sessionUrl(sessionId, directories), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
  }

  /**
   * A conversation, gone.
   */
  async deleteSession(sessionId: string, directories: string[] = []): Promise<BffDeletedResponse> {
    return fetchWrapper<BffDeletedResponse>(this.sessionUrl(sessionId, directories), {
      method: 'DELETE',
    })
  }

  /**
   * Stop what the conversation is doing.
   */
  async abortSession(sessionId: string, directories: string[] = []): Promise<BffAcceptedResponse> {
    return fetchWrapper<BffAcceptedResponse>(this.sessionUrl(sessionId, directories, 'abort'), {
      method: 'POST',
    })
  }

  /**
   * What was said in one conversation.
   *
   * The client names the conversation and, at most, the working directories it
   * works in. The layer works out where the conversation lives, so the client
   * does not have to keep a map of conversations to directories - and a
   * conversation that is not the caller's is refused the same way a
   * conversation that does not exist is.
   */
  async listMessages(
    sessionId: string,
    directories: string[] = [],
  ): Promise<BffMessageListResponse> {
    return fetchWrapper<BffMessageListResponse>(this.sessionUrl(sessionId, directories, 'messages'))
  }

  /**
   * Saying something to one conversation.
   *
   * The words, the files that go with them, and the model and the agent that
   * should answer all travel together - so the conversation is answered the
   * way it was asked, and not the way the server felt like.
   */
  async sendPrompt(
    sessionId: string,
    input: SendPromptRequest,
    directories: string[] = [],
  ): Promise<BffAcceptedResponse> {
    return fetchWrapper<BffAcceptedResponse>(this.sessionUrl(sessionId, directories, 'prompts'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  }

  /**
   * Taking a message back.
   *
   * The conversation is rolled back to the message that is named, and
   * everything after it stops counting. The layer knows where the
   * conversation lives, so the client does not have to say.
   */
  async revertSession(
    sessionId: string,
    revert: SessionRevert,
    directories: string[] = [],
  ): Promise<BffSessionResponse> {
    return fetchWrapper<BffSessionResponse>(this.sessionUrl(sessionId, directories, 'revert'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(revert),
    })
  }

  /**
   * The address of one conversation.
   *
   * The directories are a fallback, not the answer: the layer finds the
   * conversation without them whenever the ledger or the agent knows where
   * it lives.
   */
  private sessionUrl(sessionId: string, directories: string[], action?: string): string {
    const params = new URLSearchParams()
    for (const directory of directories) {
      params.append('directories', directory)
    }
    const query = params.toString()
    const suffix = action ? `/${action}` : ''
    return (
      `${this.baseURL}${BFF_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}${suffix}` +
      (query ? `?${query}` : '')
    )
  }
}

export const createBffClient = (baseURL: string) => new BffClient(baseURL)
