import type {
  ConversationStatus,
  Message,
  MessagePart,
  MessageWithParts,
  PendingPermission,
  PendingQuestion,
  PermissionResponse,
  Session,
  SessionRevert,
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
  messages?: Record<string, MessageWithParts[]>
  nextCursor?: string | null
  pendingPermissions?: PendingPermission[]
  pendingQuestions?: PendingQuestion[]
  statuses?: Record<string, ConversationStatus>
}

export interface FakeProviderCall {
  method: string
  args: unknown[]
  /**
   * The working directory the call was made about, when it was made about one.
   *
   * It is kept beside the arguments rather than among them, because the
   * arguments mean different things in different methods - and a test that
   * has to know which position the directory sits in is a test that breaks
   * when a method grows an argument.
   */
  context?: ProviderContext
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
  messages: Record<string, MessageWithParts[]>
  statusValue: ProviderStatus
  failWith: Error | null = null
  nextCursor: string | null
  pendingPermissions: PendingPermission[]
  pendingQuestions: PendingQuestion[]
  statuses: Record<string, ConversationStatus>

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
    this.statuses = options.statuses ?? {}
  }

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args })
    if (this.failWith) throw this.failWith
  }

  private recordAbout(method: string, context: ProviderContext, args: unknown[]): void {
    this.calls.push({ method, args, context })
    if (this.failWith) throw this.failWith
  }

  async status(): Promise<ProviderStatus> {
    this.record('status')
    return this.statusValue
  }

  async listSessions(context: ProviderContext, params?: ListSessionsParams): Promise<SessionPage> {
    this.recordAbout('listSessions', context, [params])
    // A session that does not say where it was worked on is given the
    // directory it was asked about - the same rule the real adapters follow.
    return {
      items: this.sessions.map((session) => ({
        ...session,
        directory: session.directory ?? context.directory ?? null,
      })),
      nextCursor: this.nextCursor,
    }
  }

  async getSession(id: string, context: ProviderContext): Promise<Session | null> {
    this.recordAbout('getSession', context, [id])
    const found = this.sessions.find((session) => session.id === id)
    if (!found) return null
    return { ...found, directory: found.directory ?? context.directory ?? null }
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
      revert: null,
      share: null,
    }
    this.sessions = [...this.sessions, session]
    return session
  }

  async renameSession(id: string, title: string, context: ProviderContext): Promise<Session> {
    this.recordAbout('renameSession', context, [id, title])
    const found = this.sessions.find((session) => session.id === id)
    if (!found) throw new Error(`no session ${id}`)
    const renamed = { ...found, title }
    this.sessions = this.sessions.map((session) => (session.id === id ? renamed : session))
    return renamed
  }

  async deleteSession(id: string, context: ProviderContext): Promise<void> {
    this.recordAbout('deleteSession', context, [id])
    this.sessions = this.sessions.filter((session) => session.id !== id)
  }

  async listMessages(sessionId: string, context: ProviderContext): Promise<MessageWithParts[]> {
    this.recordAbout('listMessages', context, [sessionId])
    return this.messages[sessionId] ?? []
  }

  async sendPrompt(sessionId: string, input: SendPromptInput, context: ProviderContext): Promise<void> {
    this.recordAbout('sendPrompt', context, [sessionId, input])
  }

  async revertSession(id: string, revert: SessionRevert, context: ProviderContext): Promise<Session> {
    this.recordAbout('revertSession', context, [id, revert])
    const found = this.sessions.find((session) => session.id === id)
    if (!found) throw new Error(`no session ${id}`)
    const reverted = { ...found, revert }
    this.sessions = this.sessions.map((session) => (session.id === id ? reverted : session))
    return reverted
  }

  async abortSession(sessionId: string, context: ProviderContext): Promise<void> {
    this.recordAbout('abortSession', context, [sessionId])
  }

  async listPendingPermissions(context: ProviderContext): Promise<PendingPermission[]> {
    this.recordAbout('listPendingPermissions', context, [])
    return this.pendingPermissions
  }

  async listPendingQuestions(context: ProviderContext): Promise<PendingQuestion[]> {
    this.recordAbout('listPendingQuestions', context, [])
    return this.pendingQuestions
  }

  async listSessionStatuses(context: ProviderContext): Promise<Record<string, ConversationStatus>> {
    this.recordAbout('listSessionStatuses', context, [])
    return this.statuses
  }

  async respondToPermission(
    id: string,
    response: PermissionResponse,
    context: ProviderContext,
  ): Promise<void> {
    this.recordAbout('respondToPermission', context, [id, response])
  }

  async replyToQuestion(id: string, answers: string[][], context: ProviderContext): Promise<void> {
    this.recordAbout('replyToQuestion', context, [id, answers])
  }

  async rejectQuestion(id: string, context: ProviderContext): Promise<void> {
    this.recordAbout('rejectQuestion', context, [id])
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
  const session: Session = {
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
    revert: null,
    share: null,
  }
  // A field that is not given stays as it was, rather than becoming
  // undefined: the shape says the field is there, and null is what it says
  // when there is nothing to say.
  return { ...session, ...overrides, revert: overrides.revert ?? session.revert }
}

export function makeMessage(
  overrides: Partial<Message> = {},
  parts?: MessagePart[],
): MessageWithParts {
  const info: Message = {
    id: 'message-1',
    sessionId: 'session-1',
    role: 'user',
    createdAt: 1000,
    completedAt: null,
    cost: null,
    tokens: null,
    modelId: null,
    providerId: null,
    agent: null,
    variant: null,
    parentId: null,
    error: null,
    ...overrides,
  }
  return {
    info,
    parts: parts ?? [{ id: 'part-1', type: 'text', text: 'hello', synthetic: null, time: null }],
  }
}
