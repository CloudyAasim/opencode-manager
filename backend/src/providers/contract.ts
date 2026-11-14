import type {
  Agent,
  AgentCapability,
  AgentDefaults,
  AgentKind,
  Command,
  ConversationStatus,
  ForkRequest,
  MessageWithParts,
  PendingPermission,
  PendingQuestion,
  PermissionResponse,
  PromptModel,
  PromptPart,
  PromptTextPart,
  SendCommandRequest,
  Session,
  SessionRevert,
  ShellRequest,
  WorkingMode,
} from '@opencode-manager/shared/api/v1'

/**
 * What one agent backend has to be able to do before the versioned API may
 * talk to it. The words here are the versioned API's words: a provider
 * translates whatever its agent speaks into these, and the API never learns
 * which agent it was talking to.
 */

export type {
  Agent,
  AgentCapability,
  AgentDefaults,
  AgentKind,
  Command,
  ForkRequest,
  MessageWithParts,
  PendingPermission,
  PendingQuestion,
  PromptModel,
  SendCommandRequest,
  Session,
  ShellRequest,
  WorkingMode,
}

/**
 * Where the agent is working. Every coding agent has one, and the versioned
 * API carries it as a query parameter rather than as part of a session id,
 * because a client that moves a session between workspaces would otherwise
 * have to invent ids.
 *
 * A provider that was asked about a directory answers with that directory's
 * sessions, and a session that does not say where it was worked on is given
 * the directory it was asked about. A session with no place belongs to nobody,
 * which is a different answer from "not yours".
 */
export interface ProviderContext {
  directory?: string
}

export interface ProviderStatus {
  status: 'ready' | 'degraded' | 'unavailable'
  detail?: string
}

export interface CreateSessionInput {
  title?: string
  directory?: string
}

/**
 * What is being said to a conversation.
 *
 * A message can be more than words: a file can be handed over with it, and
 * the model and the agent that should answer can be named. An agent that
 * cannot do one of those says so rather than quietly dropping it.
 */
export interface SendPromptInput {
  parts: PromptPart[]
  model: PromptModel | null
  agent: string | null
  variant: string | null
}

/**
 * The words in a prompt.
 *
 * An agent that only speaks words gets the words. A prompt that is only files
 * has no words in it, and the agent that cannot be given a file says so
 * rather than pretending it read one.
 */
export function promptText(input: SendPromptInput): string {
  return input.parts
    .filter((part): part is PromptTextPart => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim()
}

/**
 * How much of a session list to read, and where to carry on from.
 *
 * The cursor is the agent's own, not one of ours. An agent that has no notion
 * of paging answers with everything it has and no cursor, and the layer above
 * treats that as the end of the list rather than as a failure.
 */
export interface ListSessionsParams {
  /** How many sessions to return at most. */
  limit?: number
  /** Where to continue from, as the agent handed it back. */
  cursor?: string
  /** A word to look for among the sessions. */
  search?: string
}

/**
 * One page of sessions, and where the next one starts.
 */
export interface SessionPage {
  items: Session[]
  nextCursor: string | null
}

export interface AgentProvider {
  readonly id: string
  readonly label: string
  readonly kind: AgentKind
  readonly capabilities: readonly AgentCapability[]

  status(): Promise<ProviderStatus>
  listSessions(context: ProviderContext, params?: ListSessionsParams): Promise<SessionPage>
  getSession(id: string, context: ProviderContext): Promise<Session | null>
  createSession(input: CreateSessionInput): Promise<Session>
  renameSession(id: string, title: string, context: ProviderContext): Promise<Session>
  deleteSession(id: string, context: ProviderContext): Promise<void>
  listMessages(sessionId: string, context: ProviderContext): Promise<MessageWithParts[]>
  sendPrompt(sessionId: string, input: SendPromptInput, context: ProviderContext): Promise<void>
  /**
   * Taking a message back.
   *
   * The conversation is rolled back to the message that is named, and
   * everything after it stops counting. An agent that keeps no such thing
   * says so rather than pretending it did.
   */
  revertSession(id: string, revert: SessionRevert, context: ProviderContext): Promise<Session>
  abortSession(sessionId: string, context: ProviderContext): Promise<void>
  /**
   * The permissions the agent is waiting for.
   *
   * An agent that nobody is sitting in front of has none of these, and says
   * so by refusing rather than by answering with an empty list - "nothing is
   * waiting" and "there is nothing here to wait for" are different answers.
   */
  listPendingPermissions(context: ProviderContext): Promise<PendingPermission[]>
  /** The questions the agent is waiting for. */
  listPendingQuestions(context: ProviderContext): Promise<PendingQuestion[]>
  /**
   * How busy every conversation is, right now.
   *
   * A conversation that nobody is sitting in front of still gets on with its
   * work, and how it is getting on is asked of the agent the same way it is
   * asked over the event stream - in the same words, so a client that hears
   * about it and a client that asks for it are holding one thing.
   */
  listSessionStatuses(context: ProviderContext): Promise<Record<string, ConversationStatus>>
  /**
   * Answering a permission request.
   *
   * An agent that nobody can answer says so rather than pretending the
   * permission was granted - a permission that was never answered must not
   * look like one that was allowed.
   */
  respondToPermission(id: string, response: PermissionResponse, context: ProviderContext): Promise<void>
  /**
   * Answering a question.
   *
   * A question may have more than one part, and the answers come back in the
   * order the parts were asked.
   */
  replyToQuestion(id: string, answers: string[][], context: ProviderContext): Promise<void>
  /** Turning a question down. */
  rejectQuestion(id: string, context: ProviderContext): Promise<void>
  /**
   * The commands the agent knows.
   *
   * These are the agent's own, and they are not the conversation's: a command
   * is something the agent can be told to do, and which commands those are
   * does not depend on which conversation is open.
   */
  listCommands(context: ProviderContext): Promise<Command[]>
  /**
   * Running a command in a conversation.
   *
   * The answer is part of the conversation, so it is read from there rather
   * than handed back here - the same way a prompt's answer is.
   */
  sendCommand(
    sessionId: string,
    command: SendCommandRequest,
    context: ProviderContext,
  ): Promise<void>
  /**
   * Shortening a conversation.
   *
   * The model that writes the summary is named, because a summary is an
   * answer and an answer is written by somebody.
   */
  summarizeSession(sessionId: string, model: PromptModel, context: ProviderContext): Promise<void>
  /**
   * Taking a copy of a conversation.
   *
   * The copy is a conversation like any other, and it comes back as one - the
   * caller needs its id to open it.
   */
  forkSession(sessionId: string, fork: ForkRequest, context: ProviderContext): Promise<Session>
  /**
   * Running a command in a conversation's own shell.
   *
   * What the shell writes is part of the conversation, so it is read from
   * there rather than handed back here.
   */
  sendShell(sessionId: string, shell: ShellRequest, context: ProviderContext): Promise<void>
  /**
   * The ways of working a conversation can be had in.
   *
   * The word "agent" is taken by the program that does the work, so the ways
   * of working have a word of their own.
   */
  listWorkingModes(context: ProviderContext): Promise<WorkingMode[]>
  /**
   * What the agent does by default.
   *
   * Only the two defaults a client actually reads: the model a conversation
   * starts on, and the way of working it starts in.
   */
  getDefaults(context: ProviderContext): Promise<AgentDefaults>
}

export class AgentNotFoundError extends Error {
  constructor(public readonly agentId: string) {
    super(`No agent is registered under "${agentId}"`)
    this.name = 'AgentNotFoundError'
  }
}

export class SessionNotFoundError extends Error {
  constructor(public readonly sessionId: string) {
    super(`No session is known under "${sessionId}"`)
    this.name = 'SessionNotFoundError'
  }
}

export class ProviderUnavailableError extends Error {
  constructor(
    public readonly agentId: string,
    message?: string,
  ) {
    super(message ?? `The agent "${agentId}" is not available`)
    this.name = 'ProviderUnavailableError'
  }
}

/**
 * The agent answered, but not in a shape this provider knows how to read. It
 * is not a bad request and not a missing thing: the upstream is speaking a
 * dialect the adapter does not understand, and saying so is more useful than
 * passing a half-understood object on.
 */
export class ProviderProtocolError extends Error {
  constructor(
    public readonly agentId: string,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderProtocolError'
  }
}

/**
 * The agent could not answer at all. The adapter turns whatever its agent
 * speaks into this, so that the layer above never has to know what kind of
 * failure it is looking at.
 */
export class ProviderUpstreamError extends Error {
  constructor(
    public readonly agentId: string,
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderUpstreamError'
  }
}
