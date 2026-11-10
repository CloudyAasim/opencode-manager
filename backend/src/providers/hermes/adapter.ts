import type { Message, MessagePart, Session } from '@opencode-manager/shared/api/v1'
import {
  ProviderUnavailableError,
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

/**
 * Hermes, as a service on this machine.
 *
 * Hermes has three ways of being driven - a stdio JSON-RPC gateway, ACP, and
 * an HTTP API server - and the HTTP one is the one that speaks a language
 * other programs already know: the chat completions endpoint is the OpenAI
 * shape, and the session list is a list of sessions.
 *
 * So this adapter does not run a program. It talks to the API server, and
 * it says plainly when there is no API server to talk to: the key is not
 * optional on that surface, so without it there is nothing to ask.
 */

export interface HermesOptions {
  /** Where the API server is. */
  baseUrl?: string
  /** The key the API server insists on. */
  apiKey?: string
  /** How long a request may take. */
  timeoutMs?: number
  /** The function used to make the request, so that a test can replace it. */
  fetchImpl?: typeof fetch
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:8642'

export class HermesProvider implements AgentProvider {
  readonly id = 'hermes'
  readonly label = 'Hermes'
  readonly kind: AgentKind = 'server'
  readonly capabilities: readonly AgentCapability[] = ['sessions', 'messages', 'prompts', 'abort']

  private running: string | null = null

  constructor(private readonly options: HermesOptions = {}) {}

  private get baseUrl(): string {
    return this.options.baseUrl ?? process.env.HERMES_API_URL ?? DEFAULT_BASE_URL
  }

  private get apiKey(): string | null {
    return this.options.apiKey ?? process.env.API_SERVER_KEY ?? null
  }

  private get request(): typeof fetch {
    return this.options.fetchImpl ?? fetch
  }

  async status(): Promise<ProviderStatus> {
    if (!this.apiKey) {
      return { status: 'unavailable', detail: 'Hermes has no API server key on this machine' }
    }
    try {
      const response = await this.call('/v1/capabilities')
      if (!response.ok) {
        return { status: 'unavailable', detail: `The Hermes API server answered ${response.status}` }
      }
      return { status: 'ready' }
    } catch (error) {
      return {
        status: 'unavailable',
        detail: error instanceof Error ? error.message : 'Hermes did not answer',
      }
    }
  }

  async listSessions(_context: ProviderContext, _params?: ListSessionsParams): Promise<SessionPage> {
    const response = await this.call('/api/sessions')
    if (!response.ok) {
      throw new ProviderUnavailableError(this.id, `Hermes answered ${response.status} for its sessions`)
    }
    const body = (await response.json()) as unknown
    // The API server hands over the whole list and no way to ask for the next
    // part of it, so this page is the last one.
    return {
      items: itemsOf(body, 'sessions').map((entry) => this.toSession(entry)),
      nextCursor: null,
    }
  }

  async getSession(id: string, _context: ProviderContext): Promise<Session | null> {
    const response = await this.call(`/api/sessions/${encodeURIComponent(id)}`)
    if (response.status === 404) return null
    if (!response.ok) {
      throw new ProviderUnavailableError(this.id, `Hermes answered ${response.status} for that session`)
    }
    return this.toSession((await response.json()) as unknown)
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const response = await this.call('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ title: input.title ?? '', cwd: input.directory }),
    })
    if (!response.ok) {
      throw new ProviderUnavailableError(this.id, await this.reason(response, 'a new session'))
    }
    return this.toSession((await response.json()) as unknown)
  }

  async renameSession(id: string, title: string, _context: ProviderContext): Promise<Session> {
    const response = await this.call(`/api/sessions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    })
    if (!response.ok) {
      throw new ProviderUnavailableError(this.id, `Hermes answered ${response.status} for the new title`)
    }
    return this.toSession((await response.json()) as unknown)
  }

  async deleteSession(id: string, _context: ProviderContext): Promise<void> {
    const response = await this.call(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!response.ok && response.status !== 404) {
      throw new ProviderUnavailableError(this.id, `Hermes answered ${response.status} for the removal`)
    }
  }

  async listMessages(sessionId: string, _context: ProviderContext): Promise<Message[]> {
    const response = await this.call(
      `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
    )
    if (!response.ok) {
      throw new ProviderUnavailableError(this.id, `Hermes answered ${response.status} for the messages`)
    }
    return itemsOf((await response.json()) as unknown, 'messages').map((entry) => this.toMessage(entry))
  }

  async sendPrompt(sessionId: string, input: SendPromptInput, _context: ProviderContext): Promise<void> {
    const response = await this.call('/v1/chat/completions', {
      method: 'POST',
      headers: { 'X-Hermes-Session-Id': sessionId },
      body: JSON.stringify({
        model: 'hermes-agent',
        messages: [{ role: 'user', content: input.text }],
      }),
    })
    if (!response.ok) {
      throw new ProviderUnavailableError(this.id, `Hermes answered ${response.status} for the prompt`)
    }
  }

  async abortSession(_id: string, _context: ProviderContext): Promise<void> {
    if (!this.running) {
      throw new ProviderUnavailableError(this.id, 'Hermes is not running anything right now')
    }
    const response = await this.call(`/v1/runs/${encodeURIComponent(this.running)}/stop`, {
      method: 'POST',
    })
    this.running = null
    if (!response.ok) {
      throw new ProviderUnavailableError(this.id, `Hermes answered ${response.status} for the stop`)
    }
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const key = this.apiKey
    if (!key) {
      throw new ProviderUnavailableError(this.id, 'Hermes has no API server key on this machine')
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 120_000)
    try {
      return await this.request(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          ...(init.headers as Record<string, string> | undefined),
        },
      })
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * What the server said, when it said something.
   *
   * Hermes has rules of its own - a title has to be unique, for one - and a
   * client that answers "400" without saying which rule was broken leaves the
   * person guessing.
   */
  private async reason(response: Response, what: string): Promise<string> {
    const body = await response.text().catch(() => '')
    const detail = recordOf(safeJson(body)).detail ?? recordOf(safeJson(body)).error
    const message = typeof detail === 'string' && detail ? detail : body.slice(0, 160)
    return message
      ? `Hermes answered ${response.status} for ${what}: ${message}`
      : `Hermes answered ${response.status} for ${what}`
  }

  private toSession(raw: unknown): Session {
    // A session comes back inside an envelope - {"object": "hermes.session",
    // "session": {…}} - but a list of them is a list of the inner thing, so
    // both are read here.
    const envelope = recordOf(raw)
    const record = recordOf(envelope.session ?? raw)
    const id = stringOf(record.id) ?? stringOf(record.session_id) ?? ''
    return {
      id,
      agentId: this.id,
      title: stringOf(record.title) ?? '',
      directory: stringOf(record.cwd) ?? null,
      // Hermes works in a directory and knows of no working areas beyond it.
      workspaceId: null,
      parentId: stringOf(record.parent_session_id) ?? null,
      createdAt: numberOf(record.started_at) ?? 0,
      updatedAt: numberOf(record.ended_at) ?? numberOf(record.started_at) ?? 0,
      archived: record.archived === true,
      status: 'idle',
    }
  }

  private toMessage(raw: unknown): Message {
    const record = recordOf(raw)
    const id = stringOf(record.id) ?? (typeof record.id === 'number' ? String(record.id) : '')
    const parts: MessagePart[] = []
    const content = record.content

    if (typeof content === 'string') {
      parts.push({ id, type: 'text', text: content, tool: null })
    } else if (Array.isArray(content)) {
      for (const [index, block] of content.entries()) {
        const entry = recordOf(block)
        const type = stringOf(entry.type)
        if (type === 'text' || type === 'output_text') {
          parts.push({
            id: `${id}-${index}`,
            type: 'text',
            text: stringOf(entry.text) ?? '',
            tool: null,
          })
        }
      }
    }

    // The tool calls sit in their own column, as a JSON string, in the shape
    // the OpenAI API uses.
    for (const call of toolCallsOf(record.tool_calls)) {
      const function_ = recordOf(call.function)
      parts.push({
        id: stringOf(call.id) ?? '',
        type: 'tool',
        text: null,
        tool: {
          name: stringOf(call.name) ?? stringOf(function_.name) ?? '',
          state: 'completed',
          title: null,
          output: null,
        },
      })
    }

    return {
      id,
      sessionId: stringOf(record.session_id) ?? '',
      role: roleOf(record.role),
      createdAt: numberOf(record.timestamp) ?? 0,
      completedAt: null,
      parts,
      cost: numberOf(record.actual_cost_usd) ?? numberOf(record.estimated_cost_usd) ?? null,
      tokens: null,
    }
  }
}

/**
 * The tool calls of a message, which arrive as a JSON string in one column
 * and as an array in another.
 */
function toolCallsOf(value: unknown): Array<Record<string, unknown>> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return Array.isArray(parsed) ? parsed.map(recordOf) : []
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  return value.map(recordOf)
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** A body that is JSON, or nothing at all. */
function safeJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown
  } catch {
    return null
  }
}

/**
 * A list of things, wherever the server chose to put it. The endpoints are
 * documented; the shape of their answers is not, so the reading is forgiving
 * about the envelope and strict about the fields it knows.
 */
function itemsOf(body: unknown, key: string): unknown[] {
  if (Array.isArray(body)) return body
  const record = recordOf(body)
  for (const candidate of [key, 'data', 'items', 'results']) {
    const value = record[candidate]
    if (Array.isArray(value)) return value
  }
  return []
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function roleOf(value: unknown): Message['role'] {
  return value === 'user' || value === 'assistant' || value === 'system' ? value : 'system'
}
