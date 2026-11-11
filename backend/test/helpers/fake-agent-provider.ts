import type {
  Message,
  PendingPermission,
  PendingQuestion,
  Session,
} from '@opencode-manager/shared/api/v1'
import type {
  AgentProvider,
  CreateSessionInput,
  ListSessionsParams,
  ProviderContext,
  ProviderStatus,
  SendPromptInput,
  SessionPage,
} from '../../src/providers/contract'

export interface FakeProviderOptions {
  id?: string
  label?: string
  kind?: 'server' | 'cli'
  status?: ProviderStatus
  sessions?: Session[]
  messages?: Record<string, Message[]>
  nextCursor?: string | null
  pendingPermissions?: PendingPermission[]
  pendingQuestions?: PendingQuestion[]
}

export interface FakeProviderCall {
  method: string
  args: unknown[]
}

/**
 * A provider that answers without talking to anything. It exists so that the
 * versioned API can be exercised against an agent that is not the one this
 * repository happens to ship with: if the API only works when the real
 * backend is behind it, it is not an API, it is a client.
 */
export class FakeAgentProvider implements AgentProvider {
  readonly id: string
  readonly label: string
  readonly kind: 'server' | 'cli'
  readonly capabilities = ['sessions', 'messages', 'prompts', 'abort', 'permissions'] as const
  readonly calls: FakeProviderCall[] = []

  sessions: Session[]
  messages: Record<string, Message[]>
  statusValue: ProviderStatus
  failWith: Error | null = null
  nextCursor: string | null
  pendingPermissions: PendingPermission[]
  pendingQuestions: PendingQuestion[]

  constructor(options: FakeProviderOptions = {}) {
    this.id = options.id ?? 'fake'
    this.label = options.label ?? 'Fake'
    this.kind = options.kind ?? 'cli'
    this.statusValue = options.status ?? { status: 'ready' }
    this.sessions = options.sessions ?? []
    this.messages = options.messages ?? {}
    this.nextCursor = options.nextCursor ?? null
    this.pendingPermissions = options.pendingPermissions ?? []
    this.pendingQuestions = options.pendingQuestions ?? []
  }

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args })
    if (this.failWith) throw this.failWith
  }

  async status(): Promise<ProviderStatus> {
    this.record('status')
    return this.statusValue
  }

  async listSessions(context: ProviderContext, params?: ListSessionsParams): Promise<SessionPage> {
    this.record('listSessions', context, params)
    return { items: this.sessions, nextCursor: this.nextCursor }
  }

  async getSession(id: string, _context: ProviderContext): Promise<Session | null> {
    this.record('getSession', id)
    return this.sessions.find((session) => session.id === id) ?? null
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    this.record('createSession', input)
    const session: Session = {
      id: `session-${this.sessions.length + 1}`,
      agentId: this.id,
      title: input.title ?? '',
      directory: input.directory ?? null,
      workspaceId: null,
      parentId: null,
      createdAt: 1,
      updatedAt: 1,
      archived: false,
      status: 'idle',
    }
    this.sessions = [...this.sessions, session]
    return session
  }

  async renameSession(id: string, title: string, _context: ProviderContext): Promise<Session> {
    this.record('renameSession', id, title)
    const found = this.sessions.find((session) => session.id === id)
    if (!found) throw new Error(`no session ${id}`)
    const renamed = { ...found, title }
    this.sessions = this.sessions.map((session) => (session.id === id ? renamed : session))
    return renamed
  }

  async deleteSession(id: string, _context: ProviderContext): Promise<void> {
    this.record('deleteSession', id)
    this.sessions = this.sessions.filter((session) => session.id !== id)
  }

  async listMessages(sessionId: string, _context: ProviderContext): Promise<Message[]> {
    this.record('listMessages', sessionId)
    return this.messages[sessionId] ?? []
  }

  async sendPrompt(sessionId: string, input: SendPromptInput, _context: ProviderContext): Promise<void> {
    this.record('sendPrompt', sessionId, input)
  }

  async abortSession(sessionId: string, _context: ProviderContext): Promise<void> {
    this.record('abortSession', sessionId)
  }

  async listPendingPermissions(context: ProviderContext): Promise<PendingPermission[]> {
    this.record('listPendingPermissions', context)
    return this.pendingPermissions
  }

  async listPendingQuestions(context: ProviderContext): Promise<PendingQuestion[]> {
    this.record('listPendingQuestions', context)
    return this.pendingQuestions
  }
}

export function makePendingPermission(
  overrides: Partial<PendingPermission> = {},
): PendingPermission {
  return {
    id: 'permission-1',
    sessionId: 'session-1',
    directory: '/work',
    permission: 'bash',
    patterns: ['*'],
    metadata: {},
    always: [],
    tool: null,
    ...overrides,
  }
}

export function makePendingQuestion(overrides: Partial<PendingQuestion> = {}): PendingQuestion {
  return {
    id: 'question-1',
    sessionId: 'session-1',
    directory: '/work',
    questions: [
      {
        question: 'Which one?',
        header: 'Pick',
        options: [{ label: 'This', description: null }],
        multiple: false,
      },
    ],
    tool: null,
    ...overrides,
  }
}

export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    agentId: 'fake',
    title: 'A session',
    directory: '/work',
    workspaceId: null,
    parentId: null,
    createdAt: 1000,
    updatedAt: 2000,
    archived: false,
    status: 'idle',
    ...overrides,
  }
}

export function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'message-1',
    sessionId: 'session-1',
    role: 'user',
    createdAt: 1000,
    completedAt: null,
    parts: [{ id: 'part-1', type: 'text', text: 'hello', tool: null }],
    cost: null,
    tokens: null,
    ...overrides,
  }
}
