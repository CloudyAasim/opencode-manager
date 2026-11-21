import type {
  AgentDefaults,
  Command,
  ConversationStatus,
  ForkRequest,
  McpServer,
  McpServerConfig,
  MessageWithParts,
  PendingPermission,
  PendingQuestion,
  PermissionResponse,
  PromptModel,
  Provider,
  ProviderAuthMethod,
  ProviderOAuthAuthorization,
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
 * Where the catalogue of models lives.
 *
 * The client used to ask the agent for this itself, and got the agent's own
 * catalogue back - megabytes long, and with the provider's credentials in it.
 * Now it asks this layer, which asks the agent in its own dialect and hands
 * back the versioned one.
 */
export const BFF_PROVIDERS_ENDPOINT = '/api/bff/providers'

/**
 * Where the files that match a word live.
 */
export const BFF_FILES_ENDPOINT = '/api/bff/files'

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

/**
 * The models that may be picked.
 *
 * The providers and the models are the versioned API's - there is one truth
 * about what a model is. What this layer adds is that the catalogue is asked
 * for once, in one dialect, instead of every place that draws a picker reading
 * the agent's own words and translating them in the browser.
 */
export interface BffProviderListResponse {
  providers: Provider[]
  /** The model each provider starts on, when it has one. */
  default: Record<string, string>
}

/**
 * Where the tool servers live.
 *
 * The client used to ask the agent about these itself, at paths it built
 * itself, and for the document they are written down in - which is also where
 * the credentials of every model provider on the host live. Now it asks this
 * layer, which asks the agent and hands back the servers.
 */
export const BFF_MCP_ENDPOINT = '/api/bff/mcp'

/**
 * The files that match a word.
 */
export interface BffFileSearchResponse {
  files: string[]
}

/**
 * The tool servers the agent knows.
 *
 * The servers are the versioned API's - there is one truth about what a tool
 * server is. What this layer adds is that they come for a working directory
 * in one answer, and that what comes back is the server rather than the
 * document the server was written down in.
 */
export interface BffMcpServerListResponse {
  servers: McpServer[]
}

/**
 * Where the ways of logging a model in live.
 *
 * It is the layer the client talks to, like everything else here: the client
 * used to ask the manager's own doors for these, and those doors spoke the
 * manager's older words - and, for the ways themselves, the agent's.
 */
export const BFF_PROVIDER_AUTH_ENDPOINT = '/api/bff/provider-auth'

/**
 * Where the configuration lives.
 *
 * The client used to ask the manager's own door for this, and that door
 * answered with the document as it is written down - which is where the
 * credentials of every model provider on the host live. Four keys went into
 * the browser that way.
 *
 * The document is asked for here now, and it travels with the credentials
 * behind a word.
 */
export const BFF_CONFIG_ENDPOINT = '/api/bff/config'

/**
 * How each provider may be logged in.
 *
 * The ways themselves are the versioned API's - there is one truth about what
 * a way of logging in is.
 */
export interface BffProviderAuthMethodsResponse {
  methods: Record<string, ProviderAuthMethod[]>
}

/**
 * An authorization that has been started.
 */
export interface BffProviderOAuthAuthorizationResponse {
  authorization: ProviderOAuthAuthorization
}

/**
 * The providers that have credentials.
 */
export interface BffProviderCredentialListResponse {
  credentials: string[]
}

/**
 * One file the configuration is written down in.
 *
 * Which files those are is the agent's business, so the name is a name and
 * not something the client has to know the list of.
 */
export interface BffConfigurationSource {
  name: string
  path: string
  /** The file as it is written down, with every credential behind a word. */
  rawContent: string
  /** The same file, read as a document, with every credential behind a word. */
  content: Record<string, unknown>
  isValid: boolean
  validationIssues?: Array<{ path: string; message: string }>
  updatedAt: number
}

/**
 * The configuration, as the layer says it.
 *
 * The document is the agent's own face, and it holds the credentials of every
 * model provider on the host - so it travels with holes in it. The revision is
 * the revision of the document on disk, not of the masked one: a client that
 * sends it back is saying "this is what I read".
 */
export interface BffConfigurationDocument {
  path: string
  content: Record<string, unknown>
  rawContent: string
  isValid: boolean
  validationIssues?: Array<{ path: string; message: string }>
  updatedAt: number
  sources: BffConfigurationSource[]
  revision: string
}

export interface BffConfigurationResponse {
  configuration: BffConfigurationDocument
}

/**
 * The configuration after a change.
 *
 * `restartRequired` says that the agent is not running the configuration that
 * was just written down.
 *
 * `overriddenCredentials` names the places where the client tried to change a
 * credential and the server's own value went back there instead. They are
 * named because an edit that quietly does not happen is worse than one that is
 * refused: the person believes they changed something, and they did not.
 */
export interface BffConfigurationSaveResponse {
  configuration: BffConfigurationDocument
  restartRequired?: boolean
  overriddenCredentials?: string[]
}

/**
 * The configuration the agent is actually running with.
 */
export interface BffEffectiveConfigurationResponse {
  configuration: Record<string, unknown>
}

/**
 * A change to the configuration.
 *
 * The content is either the whole document as a document, or the text of one
 * source file as it is written down.
 */
export interface BffConfigurationUpdateRequest {
  content: Record<string, unknown> | string
  source?: string
  expectedRevision?: string
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
   * The models that may be picked.
   *
   * The catalogue belongs to the agent rather than to a working directory, so
   * the directory is named only so that the layer can say whose agent it is.
   */
  async listProviders(directories: string[] = []): Promise<BffProviderListResponse> {
    const params = new URLSearchParams()
    for (const directory of directories) {
      params.append('directories', directory)
    }
    const query = params.toString()
    return fetchWrapper<BffProviderListResponse>(
      `${this.baseURL}${BFF_PROVIDERS_ENDPOINT}` + (query ? `?${query}` : ''),
    )
  }

  /**
   * The files that match a word.
   *
   * A file search is about a working directory, so one is named - and it has
   * to be the caller's.
   */
  async searchFiles(query: string, directories: string[] = []): Promise<BffFileSearchResponse> {
    const params = new URLSearchParams({ query })
    for (const directory of directories) {
      params.append('directories', directory)
    }
    return fetchWrapper<BffFileSearchResponse>(
      `${this.baseURL}${BFF_FILES_ENDPOINT}/search?${params.toString()}`,
    )
  }

  /**
   * The tool servers the agent knows.
   *
   * A server belongs to a working directory in the sense that its
   * configuration is read from there - so a directory is named, and it has to
   * be the caller's.
   */
  async listMcpServers(directories: string[] = []): Promise<BffMcpServerListResponse> {
    const params = new URLSearchParams()
    for (const directory of directories) {
      params.append('directories', directory)
    }
    const query = params.toString()
    return fetchWrapper<BffMcpServerListResponse>(
      `${this.baseURL}${BFF_MCP_ENDPOINT}` + (query ? `?${query}` : ''),
    )
  }

  /**
   * Adding a tool server.
   */
  async addMcpServer(name: string, config: McpServerConfig): Promise<BffAcceptedResponse> {
    return fetchWrapper<BffAcceptedResponse>(`${this.baseURL}${BFF_MCP_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, config }),
    })
  }

  /**
   * Starting a tool server.
   */
  async connectMcpServer(name: string, directories: string[] = []): Promise<BffAcceptedResponse> {
    return fetchWrapper<BffAcceptedResponse>(
      this.mcpUrl(name, 'connect', directories),
      { method: 'POST' },
    )
  }

  /**
   * Stopping a tool server.
   */
  async disconnectMcpServer(
    name: string,
    directories: string[] = [],
  ): Promise<BffAcceptedResponse> {
    return fetchWrapper<BffAcceptedResponse>(
      this.mcpUrl(name, 'disconnect', directories),
      { method: 'POST' },
    )
  }

  /**
   * Asking a tool server to authorize itself.
   */
  async authenticateMcpServer(
    name: string,
    directories: string[] = [],
  ): Promise<BffAcceptedResponse> {
    return fetchWrapper<BffAcceptedResponse>(
      this.mcpUrl(name, 'auth/authenticate', directories),
      { method: 'POST' },
    )
  }

  /**
   * Finishing an authorization.
   */
  async completeMcpAuth(
    name: string,
    code: string,
    directories: string[] = [],
  ): Promise<BffAcceptedResponse> {
    return fetchWrapper<BffAcceptedResponse>(this.mcpUrl(name, 'auth/callback', directories), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
  }

  /**
   * Taking the authorization away.
   */
  async removeMcpAuth(name: string, directories: string[] = []): Promise<BffAcceptedResponse> {
    return fetchWrapper<BffAcceptedResponse>(this.mcpUrl(name, 'auth', directories), {
      method: 'DELETE',
    })
  }

  /**
   * The address of one tool server.
   *
   * The directories are the scope of the change: a change that lands in a
   * working directory belongs to the person who owns it.
   */
  private mcpUrl(name: string, action: string, directories: string[]): string {
    const params = new URLSearchParams()
    for (const directory of directories) {
      params.append('directories', directory)
    }
    const query = params.toString()
    return (
      `${this.baseURL}${BFF_MCP_ENDPOINT}/${encodeURIComponent(name)}/${action}` +
      (query ? `?${query}` : '')
    )
  }

  /**
   * The ways a provider may be logged in.
   */
  async listProviderAuthMethods(): Promise<BffProviderAuthMethodsResponse> {
    return fetchWrapper<BffProviderAuthMethodsResponse>(
      `${this.baseURL}${BFF_PROVIDER_AUTH_ENDPOINT}/methods`,
    )
  }

  /**
   * Starting an authorization.
   */
  async authorizeProviderAuth(
    providerId: string,
    request: { method: number; inputs: Record<string, string> | null },
  ): Promise<BffProviderOAuthAuthorizationResponse> {
    return fetchWrapper<BffProviderOAuthAuthorizationResponse>(
      `${this.baseURL}${BFF_PROVIDER_AUTH_ENDPOINT}/${encodeURIComponent(providerId)}/authorize`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      },
    )
  }

  /**
   * Finishing an authorization.
   */
  async completeProviderAuth(
    providerId: string,
    request: { method: number; code: string | null },
  ): Promise<BffAcceptedResponse> {
    return fetchWrapper<BffAcceptedResponse>(
      `${this.baseURL}${BFF_PROVIDER_AUTH_ENDPOINT}/${encodeURIComponent(providerId)}/callback`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      },
    )
  }

  /**
   * The providers that have credentials.
   */
  async listProviderCredentials(): Promise<BffProviderCredentialListResponse> {
    return fetchWrapper<BffProviderCredentialListResponse>(
      `${this.baseURL}${BFF_PROVIDER_AUTH_ENDPOINT}/credentials`,
    )
  }

  /**
   * Writing a credential down.
   */
  async setProviderCredential(providerId: string, apiKey: string): Promise<BffAcceptedResponse> {
    return fetchWrapper<BffAcceptedResponse>(
      `${this.baseURL}${BFF_PROVIDER_AUTH_ENDPOINT}/credentials/${encodeURIComponent(providerId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      },
    )
  }

  /**
   * Taking a credential away.
   */
  async deleteProviderCredential(providerId: string): Promise<BffAcceptedResponse> {
    return fetchWrapper<BffAcceptedResponse>(
      `${this.baseURL}${BFF_PROVIDER_AUTH_ENDPOINT}/credentials/${encodeURIComponent(providerId)}`,
      { method: 'DELETE' },
    )
  }

  /**
   * The configuration the agent runs with.
   *
   * Every credential in it is the word that stands for one: the browser gets
   * to read the configuration and to write the configuration, and the keys
   * are not part of that bargain.
   */
  async getConfiguration(): Promise<BffConfigurationResponse> {
    return fetchWrapper<BffConfigurationResponse>(`${this.baseURL}${BFF_CONFIG_ENDPOINT}`)
  }

  /**
   * Writing the configuration.
   *
   * What lands on disk is the client's document with the server's own
   * credentials in it - the client may not change a key, and it may not
   * remove one either, except by removing the provider the key belonged to.
   */
  async updateConfiguration(
    request: BffConfigurationUpdateRequest,
  ): Promise<BffConfigurationSaveResponse> {
    return fetchWrapper<BffConfigurationSaveResponse>(`${this.baseURL}${BFF_CONFIG_ENDPOINT}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  }

  /**
   * What the agent is actually running with.
   *
   * The agent's own answer rather than the file: the environment is expanded
   * and the projects are merged into it. The keys are in there too -
   * expanded, but still keys - so this travels masked like the rest.
   */
  async getEffectiveConfiguration(): Promise<BffEffectiveConfigurationResponse> {
    return fetchWrapper<BffEffectiveConfigurationResponse>(
      `${this.baseURL}${BFF_CONFIG_ENDPOINT}/effective`,
    )
  }

  /**
   * The address of one conversation.
   *
   * The directories are a fallback, not the answer: the layer finds the
   * conversation without them whenever the ledger or the agent knows where
   * it lives.
   */
  private sessionUrl(sessionId: string, directories: string[], action?: string): string {    const params = new URLSearchParams()
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
