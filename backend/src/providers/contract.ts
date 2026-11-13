import type {
  Agent,
  AgentCapability,
  AgentKind,
  MessageWithParts,
  PendingPermission,
  PendingQuestion,
  PromptModel,
  PromptPart,
  PromptTextPart,
  Session,
  SessionRevert,
} from '@opencode-manager/shared/api/v1'

/**
 * What one agent backend has to be able to do before the versioned API may
 * talk to it. The words here are the versioned API's words: a provider
 * translates whatever its agent speaks into these, and the API never learns
 * which agent it was talking to.
 */

export type { Agent, AgentCapability, AgentKind, MessageWithParts, PendingPermission, PendingQuestion, Session }

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
