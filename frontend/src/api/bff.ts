import type {
  AgentDefaults,
  Command,
  ConversationStatus,
  ForkRequest,
  MessageWithParts,
  PendingPermission,
  PendingQuestion,
  PermissionResponse,
  PromptModel,
  SendCommandRequest,
  SendPromptRequest,
  Session,
  SessionRevert,
  ShellRequest,
  WorkingMode,
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
 * Where the statuses live.
 *
 * The same layer, the same rule: the client asks it, and it asks the agent.
 */
export const BFF_STATUS_ENDPOINT = '/api/bff/status'

/**
 * Where the commands live.
 *
 * The agent's own face, asked through the same layer: the client no longer
 * holds the agent's words about them.
 */
export const BFF_COMMANDS_ENDPOINT = '/api/bff/commands'

/**
 * Where the ways of working live.
 */
export const BFF_WORKING_MODES_ENDPOINT = '/api/bff/working-modes'

/**
 * Where the defaults live.
 */
export const BFF_DEFAULTS_ENDPOINT = '/api/bff/defaults'

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

/**
 * How busy every conversation is.
 *
 * The statuses are the versioned API's - there is one truth about how busy a
 * conversation is, and the event stream says it in the same words. What this
 * layer adds is that they come for every directory at once.
 */
export interface BffConversationStatusResponse {
  statuses: Record<string, ConversationStatus>
}

/**
 * The commands the agent knows.
 *
 * The commands are the versioned API's - there is one truth about what a
 * command is, whichever agent is behind it.
 */
export interface BffCommandListResponse {
  commands: Command[]
}

/**
 * The ways of working a conversation can be had in.
 */
export interface BffWorkingModeListResponse {
  workingModes: WorkingMode[]
}

/**
 * What the agent does by default.
 */
export interface BffAgentDefaultsResponse {
  defaults: AgentDefaults
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
   * How busy every conversation is, across the named directories.
   *
   * One request for every directory, the way the session list is one request
   * for every directory. The statuses are said in the versioned dialect, the
   * same words the event stream says them in.
   */
  async listStatuses(directories: string[]): Promise<BffConversationStatusResponse> {
    const params = new URLSearchParams()
    for (const directory of directories) {
      params.append('directories', directory)
    }
    return fetchWrapper<BffConversationStatusResponse>(
      `${this.baseURL}${BFF_STATUS_ENDPOINT}?${params.toString()}`,
    )
  }

  /**
   * Answering a permission request.
   *
   * The permission hangs on a conversation, so the conversation is named: the
   * layer works out where it lives and whether it is the caller's.
   */
  async respondToPermission(
    sessionId: string,
    permissionId: string,
    reply: PermissionResponse,
    directories: string[] = [],
  ): Promise<BffAcceptedResponse> {
    return fetchWrapper<BffAcceptedResponse>(
      this.sessionUrl(sessionId, directories, `permissions/${encodeURIComponent(permissionId)}/reply`),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply }),
      },
    )
  }

  /**
   * Answering a question.
   *
   * A question may have more than one part, and the answers come back in the
   * order the parts were asked.
   */
  async replyToQuestion(
    sessionId: string,
    questionId: string,
    answers: string[][],
    directories: string[] = [],
  ): Promise<BffAcceptedResponse> {
    return fetchWrapper<BffAcceptedResponse>(
      this.sessionUrl(sessionId, directories, `questions/${encodeURIComponent(questionId)}/reply`),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      },
    )
  }

  /**
   * Turning a question down.
   */
  async rejectQuestion(
    sessionId: string,
    questionId: string,
    directories: string[] = [],
  ): Promise<BffAcceptedResponse> {
    return fetchWrapper<BffAcceptedResponse>(
      this.sessionUrl(sessionId, directories, `questions/${encodeURIComponent(questionId)}/reject`),
      { method: 'POST' },
    )
  }

  /**
   * The commands the agent knows.
   *
   * The agent's own face, in the versioned dialect: the client draws the same
   * command palette whichever agent is behind it.
   */
  async listCommands(directories: string[] = []): Promise<BffCommandListResponse> {
    const params = new URLSearchParams()
    for (const directory of directories) {
      params.append('directories', directory)
    }
    const query = params.toString()
    return fetchWrapper<BffCommandListResponse>(
      `${this.baseURL}${BFF_COMMANDS_ENDPOINT}` + (query ? `?${query}` : ''),
    )
  }

  /**
   * The ways of working a conversation can be had in.
   */
  async listWorkingModes(directories: string[] = []): Promise<BffWorkingModeListResponse> {
    const params = new URLSearchParams()
    for (const directory of directories) {
      params.append('directories', directory)
    }
    const query = params.toString()
    return fetchWrapper<BffWorkingModeListResponse>(
      `${this.baseURL}${BFF_WORKING_MODES_ENDPOINT}` + (query ? `?${query}` : ''),
    )
  }

  /**
   * What the agent does by default.
   */
  async getDefaults(directories: string[] = []): Promise<BffAgentDefaultsResponse> {
    const params = new URLSearchParams()
    for (const directory of directories) {
      params.append('directories', directory)
    }
    const query = params.toString()
    return fetchWrapper<BffAgentDefaultsResponse>(
      `${this.baseURL}${BFF_DEFAULTS_ENDPOINT}` + (query ? `?${query}` : ''),
    )
  }

  /**
   * Running a command in one conversation.
   *
   * The command hangs on the conversation, so the conversation is named: the
   * layer works out where it lives and whether it is the caller's.
   */
  async sendCommand(
    sessionId: string,
    command: SendCommandRequest,
    directories: string[] = [],
  ): Promise<BffAcceptedResponse> {
    return fetchWrapper<BffAcceptedResponse>(
      this.sessionUrl(sessionId, directories, 'commands'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      },
    )
  }

  /**
   * Shortening one conversation.
   */
  async summarizeSession(
    sessionId: string,
    model: PromptModel,
    directories: string[] = [],
  ): Promise<BffAcceptedResponse> {
    return fetchWrapper<BffAcceptedResponse>(
      this.sessionUrl(sessionId, directories, 'summarize'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      },
    )
  }

  /**
   * Taking a copy of one conversation.
   */
  async forkSession(
    sessionId: string,
    fork: ForkRequest,
    directories: string[] = [],
  ): Promise<BffSessionResponse> {
    return fetchWrapper<BffSessionResponse>(
      this.sessionUrl(sessionId, directories, 'fork'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fork),
      },
    )
  }

  /**
   * Running a command in one conversation's own shell.
   */
  async sendShell(
    sessionId: string,
    shell: ShellRequest,
    directories: string[] = [],
  ): Promise<BffAcceptedResponse> {
    return fetchWrapper<BffAcceptedResponse>(
      this.sessionUrl(sessionId, directories, 'shell'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shell),
      },
    )
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
