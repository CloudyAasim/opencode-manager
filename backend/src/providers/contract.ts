import type {
  Agent,
  AgentCapability,
  AgentKind,
  Message,
  Session,
} from '@opencode-manager/shared/api/v1'

/**
 * What one agent backend has to be able to do before the versioned API may
 * talk to it. The words here are the versioned API's words: a provider
 * translates whatever its agent speaks into these, and the API never learns
 * which agent it was talking to.
 */

export type { Agent, AgentCapability, AgentKind, Message, Session }

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

export interface SendPromptInput {
  text: string
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
  listMessages(sessionId: string, context: ProviderContext): Promise<Message[]>
  sendPrompt(sessionId: string, input: SendPromptInput, context: ProviderContext): Promise<void>
  abortSession(sessionId: string, context: ProviderContext): Promise<void>
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
