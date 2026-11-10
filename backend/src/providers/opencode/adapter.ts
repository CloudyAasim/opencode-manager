import type { Message, MessagePart, Session, SessionStatus, ToolCallState } from '@opencode-manager/shared/api/v1'
import { UpstreamError, type OpenCodeClient } from '../../services/opencode/client'
import {
  ProviderProtocolError,
  ProviderUpstreamError,
  SessionNotFoundError,
  type AgentCapability,
  type AgentKind,
  type AgentProvider,
  type CreateSessionInput,
  type ListSessionsParams,
  type ProviderContext,
  type ProviderStatus,
  type SendPromptInput,
  type SessionPage,
} from '../contract'

const AGENT_ID = 'opencode'

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toolStateOf(value: unknown): ToolCallState {
  const status = asString(asRecord(value)?.status)
  if (status === 'running' || status === 'completed' || status === 'error') return status
  return 'pending'
}

export function toPart(raw: unknown): MessagePart {
  const record = asRecord(raw)
  const id = asString(record?.id) ?? ''
  const type = asString(record?.type) ?? ''

  if (type === 'text' || type === 'reasoning') {
    return { id, type, text: asString(record?.text) ?? '', tool: null }
  }

  if (type === 'tool') {
    const state = asRecord(record?.state)
    return {
      id,
      type: 'tool',
      text: null,
      tool: {
        name: asString(record?.tool) ?? '',
        state: toolStateOf(state),
        title: asString(state?.title) ?? null,
        output: asString(state?.output) ?? null,
      },
    }
  }

  if (type === 'file') {
    return { id, type: 'file', text: asString(record?.filename) ?? null, tool: null }
  }

  return { id, type: 'other', text: null, tool: null }
}

export function toMessage(raw: unknown, agentId: string): Message {
  const payload = asRecord(raw)
  const info = asRecord(payload?.info)
  const id = asString(info?.id)

  if (!id) {
    throw new ProviderProtocolError(agentId, 'The agent answered with a message that has no id')
  }

  const time = asRecord(info?.time)
  const tokens = asRecord(info?.tokens)
  const cache = asRecord(tokens?.cache)
  const role = asString(info?.role)

  return {
    id,
    sessionId: asString(info?.sessionID) ?? '',
    role: role === 'user' || role === 'assistant' ? role : 'system',
    createdAt: asNumber(time?.created) ?? 0,
    completedAt: asNumber(time?.completed) ?? null,
    parts: Array.isArray(payload?.parts) ? payload.parts.map(toPart) : [],
    cost: asNumber(info?.cost) ?? null,
    tokens: tokens
      ? {
          input: asNumber(tokens.input) ?? 0,
          output: asNumber(tokens.output) ?? 0,
          reasoning: asNumber(tokens.reasoning) ?? 0,
          cacheRead: asNumber(cache?.read) ?? 0,
          cacheWrite: asNumber(cache?.write) ?? 0,
        }
      : null,
  }
}

export function toSession(
  raw: unknown,
  agentId: string,
  status: SessionStatus = 'unknown',
  fallbackDirectory?: string,
): Session {
  const record = asRecord(raw)
  const id = asString(record?.id)

  if (!id) {
    throw new ProviderProtocolError(agentId, 'The agent answered with a session that has no id')
  }

  const time = asRecord(record?.time)
  // Two shapes, one session. The older endpoint puts the working directory on
  // the session itself; the newer one puts it in a `location` object beside
  // it. Reading both is not guessing - it is refusing to answer "where was
  // this worked on" with "nowhere" because the answer moved.
  const location = asRecord(record?.location)

  return {
    id,
    agentId,
    title: asString(record?.title) ?? '',
    directory: asString(location?.directory) ?? asString(record?.directory) ?? fallbackDirectory ?? null,
    workspaceId: asString(location?.workspaceID) ?? asString(record?.workspaceID) ?? null,
    parentId: asString(record?.parentID) ?? null,
    createdAt: asNumber(time?.created) ?? 0,
    updatedAt: asNumber(time?.updated) ?? 0,
    archived: asNumber(time?.archived) !== null,
    status,
  }
}

/**
 * One page of sessions, read out of whatever shape the agent answered with.
 *
 * The newer endpoint answers with an envelope - the items and a cursor that
 * says where the next page starts - while the older one answers with a bare
 * list and no way to continue. Both are pages; one of them happens to be the
 * last.
 *
 * `fallbackDirectory` is the directory that was asked about. An agent that
 * does not say where a session was worked on has still answered "the sessions
 * of this directory", and a session with no place belongs to nobody - which is
 * a different answer from "not yours".
 */
export function toSessionPage(
  raw: unknown,
  agentId: string,
  fallbackDirectory?: string,
): SessionPage {
  const record = asRecord(raw)
  const payload = Array.isArray(raw) ? raw : (record?.data ?? record?.items ?? [])
  const items = Array.isArray(payload) ? payload : []
  const cursor = asRecord(record?.cursor)

  return {
    items: items.map((item) => toSession(item, agentId, 'unknown', fallbackDirectory)),
    nextCursor: asString(cursor?.next),
  }
}

function statusOf(raw: unknown): SessionStatus {
  const type = asString(asRecord(raw)?.type)
  if (type === 'idle') return 'idle'
  if (type === 'busy' || type === 'retry') return 'busy'
  return 'unknown'
}

export interface OpenCodeProviderOptions {
  isReady?: () => boolean
}

export class OpenCodeProvider implements AgentProvider {
  readonly id = AGENT_ID
  readonly label = 'OpenCode'
  readonly kind: AgentKind = 'server'
  readonly capabilities: readonly AgentCapability[] = ['sessions', 'messages', 'prompts', 'abort']

  constructor(
    private readonly client: OpenCodeClient,
    private readonly options: OpenCodeProviderOptions = {},
  ) {}

  async status(): Promise<ProviderStatus> {
    if (this.options.isReady && !this.options.isReady()) {
      return { status: 'unavailable', detail: 'The OpenCode server is not running' }
    }
    return { status: 'ready' }
  }

  async listSessions(context: ProviderContext, params: ListSessionsParams = {}): Promise<SessionPage> {
    const raw = await this.readJson<unknown>(this.sessionsPath(params), context)
    const page = toSessionPage(raw, this.id, context.directory)
    const statuses = await this.readStatuses(context)
    return {
      items: page.items.map((session) => ({ ...session, status: statuses.get(session.id) ?? 'unknown' })),
      nextCursor: page.nextCursor,
    }
  }

  async getSession(id: string, context: ProviderContext): Promise<Session | null> {
    try {
      const raw = await this.readJson<unknown>(this.sessionPath(id), context, id)
      return toSession(raw, this.id, 'unknown', context.directory)
    } catch (error) {
      if (error instanceof SessionNotFoundError) return null
      throw error
    }
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const body = input.title ? { title: input.title } : {}
    let raw: unknown
    try {
      raw = await this.client.postJson<unknown>('/session', body, { directory: input.directory })
    } catch (error) {
      throw this.translate(error)
    }
    return toSession(raw, this.id, 'unknown', input.directory)
  }

  async renameSession(id: string, title: string, context: ProviderContext): Promise<Session> {
    const raw = await this.write({
      method: 'PATCH',
      path: this.sessionPath(id),
      body: JSON.stringify({ title }),
      headers: { 'Content-Type': 'application/json' },
      context,
      sessionId: id,
    })
    return toSession(raw, this.id, 'unknown', context.directory)
  }

  async deleteSession(id: string, context: ProviderContext): Promise<void> {
    await this.write({
      method: 'DELETE',
      path: this.sessionPath(id),
      context,
      sessionId: id,
    })
  }

  async listMessages(sessionId: string, context: ProviderContext): Promise<Message[]> {
    const raw = await this.readJson<unknown>(`${this.sessionPath(sessionId)}/message`, context, sessionId)
    const items = Array.isArray(raw) ? raw : []
    return items.map((item) => toMessage(item, this.id))
  }

  async sendPrompt(sessionId: string, input: SendPromptInput, context: ProviderContext): Promise<void> {
    await this.write({
      method: 'POST',
      path: `${this.sessionPath(sessionId)}/prompt_async`,
      body: JSON.stringify({ parts: [{ type: 'text', text: input.text }] }),
      headers: { 'Content-Type': 'application/json' },
      context,
      sessionId,
    })
  }

  async abortSession(sessionId: string, context: ProviderContext): Promise<void> {
    await this.write({
      method: 'POST',
      path: `${this.sessionPath(sessionId)}/abort`,
      context,
      sessionId,
    })
  }

  private sessionPath(id: string): string {
    return `/session/${encodeURIComponent(id)}`
  }

  /**
   * The endpoint that pages. The one that lists a single session does not
   * page, so the two are different requests and not one request with options.
   */
  private sessionsPath(params: ListSessionsParams): string {
    const query = new URLSearchParams()
    query.set('order', 'desc')
    if (params.limit !== undefined) query.set('limit', String(params.limit))
    if (params.cursor) query.set('cursor', params.cursor)
    if (params.search) query.set('search', params.search)
    return `/api/session?${query.toString()}`
  }

  private async readJson<T>(path: string, context: ProviderContext, sessionId?: string): Promise<T> {
    try {
      return await this.client.getJson<T>(path, { directory: context.directory })
    } catch (error) {
      throw this.translate(error, sessionId)
    }
  }

  private async write(request: {
    method: string
    path: string
    body?: string
    headers?: Record<string, string>
    context: ProviderContext
    sessionId?: string
  }): Promise<unknown> {
    const response = await this.client.forward({
      method: request.method,
      path: request.path,
      body: request.body,
      headers: request.headers,
      directory: request.context.directory,
    })

    if (!response.ok) {
      throw this.translate(
        new UpstreamError(response.status, await response.text().catch(() => '')),
        request.sessionId,
      )
    }

    const text = await response.text()
    if (!text) return null
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new ProviderProtocolError(this.id, `The agent answered with something that is not JSON`)
    }
  }

  private translate(error: unknown, sessionId?: string): Error {
    if (error instanceof UpstreamError) {
      if (error.status === 404) {
        return new SessionNotFoundError(sessionId ?? '*')
      }
      return new ProviderUpstreamError(
        this.id,
        error.status,
        `The agent answered with ${error.status}`,
      )
    }
    return error instanceof Error ? error : new Error(String(error))
  }

  private async readStatuses(context: ProviderContext): Promise<Map<string, SessionStatus>> {
    const statuses = new Map<string, SessionStatus>()
    try {
      const raw = await this.client.getJson<Record<string, unknown>>('/session/status', {
        directory: context.directory,
      })
      for (const [id, value] of Object.entries(raw ?? {})) {
        statuses.set(id, statusOf(value))
      }
    } catch {
      // The status of a session is a convenience, not the session itself: a
      // server that cannot answer the question must not make the list fail.
    }
    return statuses
  }
}
