import type {
  AgentDefaults,
  Command,
  ConversationStatus,
  ForkRequest,
  Message,
  MessageError,
  MessagePart,
  MessageWithParts,
  PendingPermission,
  PendingQuestion,
  PendingQuestionInfo,
  PendingRequestTool,
  PermissionResponse,
  PromptModel,
  SendCommandRequest,
  Session,
  SessionRevert,
  SessionShare,
  SessionStatus,
  ShellRequest,
  TimeRange,
  TokenUsage,
  ToolCallState,
  WorkingMode,
  WorkingModeScope,
} from '@opencode-manager/shared/api/v1'
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

/** An open record, or null - the agent's own words, kept as they are. */
function asOpenRecord(value: unknown): Record<string, unknown> | null {
  return asRecord(value)
}

/** When something started, and when it stopped - if it ever did. */
function toTimeRange(raw: Record<string, unknown> | null): TimeRange | null {
  if (!raw) return null
  const start = asNumber(raw.start)
  if (start === null) return null
  return { start, end: asNumber(raw.end) }
}

/** What the model spent, counted the same way wherever it is counted. */
function toTokenUsage(raw: unknown): TokenUsage {
  const tokens = asRecord(raw)
  const cache = asRecord(tokens?.cache)
  return {
    input: asNumber(tokens?.input) ?? 0,
    output: asNumber(tokens?.output) ?? 0,
    reasoning: asNumber(tokens?.reasoning) ?? 0,
    cacheRead: asNumber(cache?.read) ?? 0,
    cacheWrite: asNumber(cache?.write) ?? 0,
  }
}

/**
 * Why a message failed, in the versioned dialect.
 *
 * The agent throws named errors; the versioned API says what kind of failure
 * this is. An error nobody recognises is not an error nobody has: it is an
 * unknown one, and saying so is better than dropping the reason it failed.
 */
export function toMessageError(raw: unknown): MessageError {
  const record = asRecord(raw)
  const name = asString(record?.name) ?? ''
  const data = asRecord(record?.data)
  const message = asString(data?.message) ?? ''

  if (name === 'ProviderAuthError') {
    return {
      kind: 'authentication',
      message: message || 'The provider refused the credentials',
      providerId: asString(data?.providerID) ?? null,
      statusCode: null,
      isRetryable: false,
    }
  }
  if (name === 'MessageOutputLengthError') {
    return {
      kind: 'output-length',
      message: message || 'The answer was longer than the model allows',
      providerId: null,
      statusCode: null,
      isRetryable: false,
    }
  }
  if (name === 'MessageAbortedError') {
    return {
      kind: 'aborted',
      message: message || 'The run was stopped',
      providerId: null,
      statusCode: null,
      isRetryable: false,
    }
  }
  if (name === 'APIError') {
    return {
      kind: 'api',
      message: message || 'The upstream refused the request',
      providerId: null,
      statusCode: asNumber(data?.statusCode) ?? null,
      isRetryable: data?.isRetryable === true,
    }
  }
  return {
    kind: 'unknown',
    message: message || 'Something went wrong',
    providerId: null,
    statusCode: null,
    isRetryable: true,
  }
}

/**
 * One piece of a message, in the versioned dialect.
 *
 * The agent knows thirteen kinds of piece and the versioned API knows the same
 * thirteen, called the same way: these are the parts of a conversation, and
 * they are the same parts whichever agent is having the conversation.
 *
 * A piece of a kind the versioned API does not know is not dropped. It is
 * called "other" and keeps whatever words it had, because a client that loses
 * a piece of a conversation has lost part of the answer.
 */
export function toPart(raw: unknown): MessagePart {
  const record = asRecord(raw)
  const id = asString(record?.id) ?? ''
  const type = asString(record?.type) ?? ''

  if (type === 'text') {
    return {
      id,
      type: 'text',
      text: asString(record?.text) ?? '',
      synthetic: typeof record?.synthetic === 'boolean' ? record.synthetic : null,
      time: toTimeRange(asRecord(record?.time)),
    }
  }

  if (type === 'reasoning') {
    return {
      id,
      type: 'reasoning',
      text: asString(record?.text) ?? '',
      time: toTimeRange(asRecord(record?.time)),
    }
  }

  if (type === 'tool') {
    const state = asRecord(record?.state)
    // The tool's own metadata and the state it is in say different things,
    // and the conversation a task handed off to is sometimes in one and
    // sometimes in the other. They are folded into one place, so a client
    // does not have to know which of the two the agent happened to use - and
    // the tool's own wins, because that is where it is when it is there.
    const metadata = {
      ...asOpenRecord(state?.metadata),
      ...asOpenRecord(record?.metadata),
    }
    return {
      id,
      type: 'tool',
      callId: asString(record?.callID) ?? '',
      name: asString(record?.tool) ?? '',
      state: {
        status: toolStateOf(state),
        title: asString(state?.title) ?? null,
        output: asString(state?.output) ?? null,
        error: asString(state?.error) ?? null,
        input: asOpenRecord(state?.input),
        metadata: Object.keys(metadata).length > 0 ? metadata : null,
        raw: asString(state?.raw) ?? null,
        time: toTimeRange(asRecord(state?.time)),
      },
    }
  }

  if (type === 'file') {
    return {
      id,
      type: 'file',
      filename: asString(record?.filename) ?? null,
      mime: asString(record?.mime) ?? null,
      url: asString(record?.url) ?? '',
    }
  }

  if (type === 'patch') {
    return {
      id,
      type: 'patch',
      hash: asString(record?.hash) ?? '',
      files: Array.isArray(record?.files)
        ? record.files.filter((file): file is string => typeof file === 'string')
        : [],
    }
  }

  if (type === 'agent') {
    return { id, type: 'agent', name: asString(record?.name) ?? '' }
  }

  if (type === 'subtask') {
    return {
      id,
      type: 'subtask',
      agent: asString(record?.agent) ?? '',
      description: asString(record?.description) ?? '',
      prompt: asString(record?.prompt) ?? '',
      command: asString(record?.command) ?? null,
    }
  }

  if (type === 'step-start') {
    return { id, type: 'step-start', snapshot: asString(record?.snapshot) ?? null }
  }

  if (type === 'step-finish') {
    return {
      id,
      type: 'step-finish',
      reason: asString(record?.reason) ?? '',
      snapshot: asString(record?.snapshot) ?? null,
      cost: asNumber(record?.cost) ?? 0,
      tokens: toTokenUsage(record?.tokens),
    }
  }

  if (type === 'snapshot') {
    return { id, type: 'snapshot', snapshot: asString(record?.snapshot) ?? '' }
  }

  if (type === 'retry') {
    return {
      id,
      type: 'retry',
      attempt: asNumber(record?.attempt) ?? 0,
      error: toMessageError(record?.error),
      time: toTimeRange(asRecord(record?.time)),
    }
  }

  if (type === 'compaction') {
    return { id, type: 'compaction', auto: record?.auto === true }
  }

  return { id, type: 'other', text: asString(record?.text) ?? null }
}

/**
 * One message, in the versioned dialect.
 *
 * The message itself says who said it, when, what it cost and whether it went
 * wrong. The pieces it is made of are asked for separately - they arrive one
 * at a time while the conversation is happening - so they are not in here.
 */
export function toMessage(raw: unknown, agentId: string): Message {
  const payload = asRecord(raw)
  const info = asRecord(payload?.info)
  const id = asString(info?.id)

  if (!id) {
    throw new ProviderProtocolError(agentId, 'The agent answered with a message that has no id')
  }

  const time = asRecord(info?.time)
  const role = asString(info?.role)
  // The user message keeps its model in an object and the assistant message
  // keeps it in two fields. Reading both is not guessing - it is refusing to
  // answer "which model was this" with "nobody knows" because the answer moved.
  const model = asRecord(info?.model)

  return {
    id,
    sessionId: asString(info?.sessionID) ?? '',
    role: role === 'user' || role === 'assistant' ? role : 'system',
    createdAt: asNumber(time?.created) ?? 0,
    completedAt: asNumber(time?.completed) ?? null,
    cost: asNumber(info?.cost) ?? null,
    tokens: info?.tokens ? toTokenUsage(info.tokens) : null,
    modelId: asString(model?.modelID) ?? asString(info?.modelID) ?? null,
    providerId: asString(model?.providerID) ?? asString(info?.providerID) ?? null,
    agent: asString(info?.agent) ?? null,
    variant: asString(info?.variant) ?? null,
    parentId: asString(info?.parentID) ?? null,
    error: info?.error ? toMessageError(info.error) : null,
  }
}

/** A message and the pieces it is made of, in the versioned dialect. */
export function toMessageWithParts(raw: unknown, agentId: string): MessageWithParts {
  const payload = asRecord(raw)
  return {
    info: toMessage(raw, agentId),
    parts: Array.isArray(payload?.parts) ? payload.parts.map(toPart) : [],
  }
}

/**
 * Where a conversation was rolled back to.
 *
 * The agent says which message it was rolled back to. A conversation that was
 * never rolled back says nothing, and a conversation rolled back to something
 * that is not a message is treated as never rolled back: there is no point to
 * go back to.
 */
function toSessionRevert(raw: unknown): SessionRevert | null {
  const record = asRecord(raw)
  const messageId = asString(record?.messageID)
  if (!messageId) return null
  return { messageId, partId: asString(record?.partID) ?? null }
}

/**
 * The link somebody else can read the conversation through.
 *
 * A conversation that has not been shared says so, rather than saying nothing
 * - a client that has to ask whether the field exists is a client that will
 * eventually forget to ask.
 */
function toSessionShare(raw: unknown): SessionShare | null {
  const record = asRecord(raw)
  const url = asString(record?.url)
  if (!url) return null
  return { url }
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
    revert: toSessionRevert(record?.revert),
    share: toSessionShare(record?.share),
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

/**
 * How busy a conversation is, in the words the versioned API uses.
 *
 * A status that cannot be read is not a status: answering "unknown" where the
 * agent said something else would be inventing an answer.
 */
export function toConversationStatus(raw: unknown): ConversationStatus | null {
  const record = asRecord(raw)
  const type = asString(record?.type)
  if (type === 'idle') return { type: 'idle' }
  if (type === 'busy') return { type: 'busy' }
  if (type === 'retry') {
    const attempt = asNumber(record?.attempt)
    const message = asString(record?.message)
    const next = asNumber(record?.next)
    if (attempt === null || message === null || next === null) return null
    return { type: 'retry', attempt, message, next }
  }
  return null
}

/**
 * The coarse status a session record carries.
 *
 * A conversation that is trying again is busy, and the record has no room to
 * say it is trying again - so it says busy, which is true.
 */
function statusOf(status: ConversationStatus): SessionStatus {
  return status.type === 'idle' ? 'idle' : 'busy'
}

/**
 * The tool call a pending request hangs on.
 *
 * The agent says nothing when there is no tool, and says something we cannot
 * read when it is not the shape we know. Both of those are "no tool", because
 * a request with no tool is a question the agent asked by itself.
 */
function toPendingTool(value: unknown): PendingRequestTool | null {
  const record = asRecord(value)
  if (!record) return null
  const messageId = asString(record.messageID)
  const callId = asString(record.callID)
  if (!messageId || !callId) return null
  return { messageId, callId }
}

function stringArrayOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function metadataOf(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? {}
}

/**
 * A permission the agent is waiting for, in the versioned API's words.
 *
 * The agent answers with a request that has no id or no session: that is not
 * an empty list, it is an answer we cannot read, and saying so is more useful
 * than passing a half-understood object on.
 */
export function toPendingPermission(
  raw: unknown,
  agentId: string,
  fallbackDirectory?: string,
): PendingPermission {
  const record = asRecord(raw)
  const id = asString(record?.id)
  const sessionId = asString(record?.sessionID)
  if (!id || !sessionId) {
    throw new ProviderProtocolError(
      agentId,
      'The agent answered with a pending permission that has no id or no session',
    )
  }

  return {
    id,
    sessionId,
    directory: asString(record?.directory) ?? fallbackDirectory ?? null,
    permission: asString(record?.permission) ?? '',
    patterns: stringArrayOf(record?.patterns),
    metadata: metadataOf(record?.metadata),
    always: stringArrayOf(record?.always),
    tool: toPendingTool(record?.tool),
  }
}

function toPendingQuestionInfo(raw: unknown): PendingQuestionInfo {
  const record = asRecord(raw)
  const options = Array.isArray(record?.options) ? record.options : []
  return {
    question: asString(record?.question) ?? '',
    header: asString(record?.header) ?? '',
    options: options.map((option) => {
      const entry = asRecord(option)
      return {
        label: asString(entry?.label) ?? '',
        description: asString(entry?.description) ?? null,
      }
    }),
    multiple: record?.multiple === true,
  }
}

/**
 * A question the agent is waiting for, in the versioned API's words.
 */
export function toPendingQuestion(
  raw: unknown,
  agentId: string,
  fallbackDirectory?: string,
): PendingQuestion {
  const record = asRecord(raw)
  const id = asString(record?.id)
  const sessionId = asString(record?.sessionID)
  if (!id || !sessionId) {
    throw new ProviderProtocolError(
      agentId,
      'The agent answered with a pending question that has no id or no session',
    )
  }

  const questions = Array.isArray(record?.questions) ? record.questions : []
  return {
    id,
    sessionId,
    directory: asString(record?.directory) ?? fallbackDirectory ?? null,
    questions: questions.map(toPendingQuestionInfo),
    tool: toPendingTool(record?.tool),
  }
}

/**
 * The model, said the way the versioned API says it.
 *
 * The agent says a model either as two fields or as one line of text
 * ("provider/model"), and sometimes as both depending on where it is asked.
 * Reading both is not guessing - it is refusing to answer "which model" with
 * "nowhere" because the answer moved.
 */
export function toPromptModel(raw: unknown): PromptModel | null {
  const record = asRecord(raw)
  if (record) {
    const providerId = asString(record.providerId) ?? asString(record.providerID)
    const modelId = asString(record.modelId) ?? asString(record.modelID)
    if (!providerId || !modelId) return null
    return { providerId, modelId }
  }

  const text = asString(raw)
  if (!text) return null
  // The provider is the first part and the model is the rest: a model name
  // may itself contain a slash, and splitting it the other way round would
  // name a provider that does not exist.
  const [providerId, ...rest] = text.split('/')
  const modelId = rest.join('/')
  if (!providerId || !modelId) return null
  return { providerId, modelId }
}

/** The model, said the way the agent says it. */
function modelStringOf(model: PromptModel | null): string | undefined {
  return model ? `${model.providerId}/${model.modelId}` : undefined
}

/**
 * One command, in the versioned dialect.
 *
 * The agent says which agent a command runs as; the versioned API says which
 * way of working it runs as - and says null where the agent says nothing,
 * because a field that is only sometimes there is a field every reader has to
 * ask about.
 */
export function toCommand(raw: unknown): Command {
  const record = asRecord(raw)
  const name = asString(record?.name)
  if (!name) {
    throw new ProviderProtocolError(AGENT_ID, 'The agent answered with a command that has no name')
  }

  return {
    name,
    description: asString(record?.description) ?? null,
    workingMode: asString(record?.agent) ?? null,
    model: toPromptModel(record?.model),
    template: asString(record?.template) ?? null,
    subtask: record?.subtask === true,
    hints: stringArrayOf(record?.hints),
  }
}

/**
 * One way of working, in the versioned dialect.
 *
 * The agent says what a way of working is for in one of three words: it can
 * lead a conversation, it can be handed one, or it can do both. A scope we
 * cannot read is offered rather than hidden - a way of working that
 * disappears because of a word we did not understand is worse than one that is
 * offered when it should not have been.
 */
export function toWorkingMode(raw: unknown): WorkingMode {
  const record = asRecord(raw)
  const name = asString(record?.name)
  if (!name) {
    throw new ProviderProtocolError(
      AGENT_ID,
      'The agent answered with a way of working that has no name',
    )
  }

  const mode = asString(record?.mode)
  const scope: WorkingModeScope =
    mode === 'primary' || mode === 'subagent' || mode === 'all' ? mode : 'all'

  return {
    name,
    description: asString(record?.description) ?? null,
    scope,
    hidden: record?.hidden === true,
    color: asString(record?.color) ?? null,
    // The model the way prefers, if it prefers one. The agent says it as two
    // fields; the versioned API says it as two fields too, only named the
    // other way round.
    model: toPromptModel(record?.model),
  }
}

/**
 * What the agent does by default.
 *
 * Only the two defaults a client actually reads are carried over: the model a
 * conversation starts on, and the way of working it starts in. The rest of a
 * configuration is the agent's own business, and translating all of it would
 * make this shape a report on one agent rather than a word all of them share.
 */
export function toAgentDefaults(raw: unknown): AgentDefaults {
  const record = asRecord(raw)
  return {
    model: toPromptModel(record?.model),
    // The field was renamed once; reading both is not guessing.
    workingMode: asString(record?.default_agent) ?? asString(record?.defaultAgent) ?? null,
  }
}

export interface OpenCodeProviderOptions {
  isReady?: () => boolean
}

export class OpenCodeProvider implements AgentProvider {
  readonly id = AGENT_ID
  readonly label = 'OpenCode'
  readonly kind: AgentKind = 'server'
  readonly capabilities: readonly AgentCapability[] = [
    'sessions',
    'messages',
    'prompts',
    'abort',
    'permissions',
  ]

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
      items: page.items.map((session) => {
        const status = statuses.get(session.id)
        return { ...session, status: status ? statusOf(status) : 'unknown' }
      }),
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
    const response = await this.client.forward({
      method: 'DELETE',
      path: this.sessionPath(id),
      directory: context.directory,
    })

    if (response.ok) return

    const status = response.status
    const body = await response.text().catch(() => '')

    // A conversation filed inside a working area cannot be removed by
    // removing the conversation when that area is already gone, and the agent
    // says so with an error rather than with a conversation that is still
    // there. The area is what has to go instead.
    //
    // The browser used to do this itself, from an error message it had
    // guessed at, and it knew the working area's id because it had the
    // conversation on screen. Here the id is read from the agent, and the
    // guessing is gone: the words that mean "the area is gone" are the
    // agent's own.
    if (status === 500 || body.includes('Workspace not found')) {
      const workspaceId = await this.workspaceIdOf(id, context)
      if (workspaceId && (await this.removeWorkspace(workspaceId, context))) return
    }

    throw this.translate(new UpstreamError(status, body), id)
  }

  /**
   * The working area a conversation is filed in, when it is filed in one.
   */
  private async workspaceIdOf(id: string, context: ProviderContext): Promise<string | null> {
    try {
      const raw = await this.readJson<unknown>(this.sessionPath(id), context, id)
      const record = asRecord(raw)
      const location = asRecord(record?.location)
      return asString(location?.workspaceID) ?? asString(record?.workspaceID) ?? null
    } catch {
      return null
    }
  }

  /**
   * Removing a working area, and whether it went.
   *
   * The endpoint is the agent's, and it is experimental there - which is
   * exactly why it belongs here and not in the layer above: the layer above
   * asks for a working area to go and does not know what one is.
   */
  private async removeWorkspace(id: string, context: ProviderContext): Promise<boolean> {
    try {
      const response = await this.client.forward({
        method: 'DELETE',
        path: `/experimental/workspace/${encodeURIComponent(id)}`,
        directory: context.directory,
      })
      return response.ok
    } catch {
      return false
    }
  }

  async listMessages(sessionId: string, context: ProviderContext): Promise<MessageWithParts[]> {
    const raw = await this.readJson<unknown>(`${this.sessionPath(sessionId)}/message`, context, sessionId)
    const items = Array.isArray(raw) ? raw : []
    return items.map((item) => toMessageWithParts(item, this.id))
  }

  async sendPrompt(sessionId: string, input: SendPromptInput, context: ProviderContext): Promise<void> {
    await this.write({
      method: 'POST',
      path: `${this.sessionPath(sessionId)}/prompt_async`,
      body: JSON.stringify({
        parts: input.parts.map((part) =>
          part.type === 'text'
            ? { type: 'text', text: part.text }
            : { type: 'file', mime: part.mime, filename: part.filename, url: part.url },
        ),
        ...(input.model ? { model: { providerID: input.model.providerId, modelID: input.model.modelId } } : {}),
        ...(input.agent ? { agent: input.agent } : {}),
        ...(input.variant ? { variant: input.variant } : {}),
      }),
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

  /**
   * Taking a message back.
   *
   * The agent does the taking; the answer is the conversation as it is
   * afterwards, read back from the agent rather than guessed at here.
   */
  async revertSession(id: string, revert: SessionRevert, context: ProviderContext): Promise<Session> {
    await this.write({
      method: 'POST',
      path: `${this.sessionPath(id)}/revert`,
      body: JSON.stringify({
        messageID: revert.messageId,
        ...(revert.partId ? { partID: revert.partId } : {}),
      }),
      headers: { 'Content-Type': 'application/json' },
      context,
      sessionId: id,
    })

    const session = await this.getSession(id, context)
    if (!session) throw new SessionNotFoundError(id)
    return session
  }

  async listPendingPermissions(context: ProviderContext): Promise<PendingPermission[]> {
    const raw = await this.readJson<unknown>('/permission', context)
    const items = Array.isArray(raw) ? raw : []
    return items.map((item) => toPendingPermission(item, this.id, context.directory))
  }

  async listPendingQuestions(context: ProviderContext): Promise<PendingQuestion[]> {
    const raw = await this.readJson<unknown>('/question', context)
    const items = Array.isArray(raw) ? raw : []
    return items.map((item) => toPendingQuestion(item, this.id, context.directory))
  }

  /**
   * How busy every conversation is, right now.
   *
   * Unlike the list of conversations, this is asked for on purpose, so a
   * failure is a failure: an agent that cannot say how busy it is must not
   * answer "nothing is busy", which is a different and wrong answer.
   */
  async listSessionStatuses(context: ProviderContext): Promise<Record<string, ConversationStatus>> {
    const raw = await this.client.getJson<Record<string, unknown>>('/session/status', {
      directory: context.directory,
    })
    const statuses: Record<string, ConversationStatus> = {}
    for (const [id, value] of Object.entries(raw ?? {})) {
      const status = toConversationStatus(value)
      if (status) statuses[id] = status
    }
    return statuses
  }

  async respondToPermission(
    id: string,
    response: PermissionResponse,
    context: ProviderContext,
  ): Promise<void> {
    await this.write({
      method: 'POST',
      path: `/permission/${encodeURIComponent(id)}/reply`,
      body: JSON.stringify({ reply: response }),
      headers: { 'Content-Type': 'application/json' },
      context,
    })
  }

  async replyToQuestion(id: string, answers: string[][], context: ProviderContext): Promise<void> {
    await this.write({
      method: 'POST',
      path: `/question/${encodeURIComponent(id)}/reply`,
      body: JSON.stringify({ answers }),
      headers: { 'Content-Type': 'application/json' },
      context,
    })
  }

  async rejectQuestion(id: string, context: ProviderContext): Promise<void> {
    await this.write({
      method: 'POST',
      path: `/question/${encodeURIComponent(id)}/reject`,
      context,
    })
  }

  /**
   * The commands this agent knows.
   *
   * The commands are not the conversation's, so they are asked for on purpose
   * and a failure is a failure: an agent that cannot say what it can be told
   * to do must not answer "nothing", which is a different and wrong answer.
   */
  async listCommands(context: ProviderContext): Promise<Command[]> {
    const raw = await this.readJson<unknown>('/command', context)
    const items = Array.isArray(raw) ? raw : []
    return items.map(toCommand)
  }

  /**
   * Running a command in a conversation.
   *
   * The answer comes back as a message in the conversation, so it is read from
   * there rather than carried back here - the same way a prompt's answer is.
   */
  async sendCommand(
    sessionId: string,
    command: SendCommandRequest,
    context: ProviderContext,
  ): Promise<void> {
    await this.write({
      method: 'POST',
      path: `${this.sessionPath(sessionId)}/command`,
      body: JSON.stringify({
        command: command.command,
        arguments: command.arguments,
        ...(command.workingMode ? { agent: command.workingMode } : {}),
        ...(command.model ? { model: modelStringOf(command.model) } : {}),
      }),
      headers: { 'Content-Type': 'application/json' },
      context,
      sessionId,
    })
  }

  /**
   * Shortening a conversation.
   */
  async summarizeSession(
    sessionId: string,
    model: PromptModel,
    context: ProviderContext,
  ): Promise<void> {
    await this.write({
      method: 'POST',
      path: `${this.sessionPath(sessionId)}/summarize`,
      body: JSON.stringify({
        providerID: model.providerId,
        modelID: model.modelId,
      }),
      headers: { 'Content-Type': 'application/json' },
      context,
      sessionId,
    })
  }

  /**
   * Taking a copy of a conversation.
   *
   * The copy is a conversation like any other, and it is read back from the
   * agent rather than guessed at here.
   */
  async forkSession(sessionId: string, fork: ForkRequest, context: ProviderContext): Promise<Session> {
    const raw = await this.write({
      method: 'POST',
      path: `${this.sessionPath(sessionId)}/fork`,
      body: JSON.stringify(fork.messageId ? { messageID: fork.messageId } : {}),
      headers: { 'Content-Type': 'application/json' },
      context,
      sessionId,
    })
    return toSession(raw, this.id, 'unknown', context.directory)
  }

  /**
   * Running a command in a conversation's own shell.
   *
   * The shell needs a way of working even when the caller did not name one,
   * and the one to use then is this agent's own catch-all - the way of
   * working that is meant for everything.
   */
  async sendShell(sessionId: string, shell: ShellRequest, context: ProviderContext): Promise<void> {
    await this.write({
      method: 'POST',
      path: `${this.sessionPath(sessionId)}/shell`,
      body: JSON.stringify({
        command: shell.command,
        agent: shell.workingMode ?? 'general',
      }),
      headers: { 'Content-Type': 'application/json' },
      context,
      sessionId,
    })
  }

  /**
   * The ways of working a conversation can be had in.
   */
  async listWorkingModes(context: ProviderContext): Promise<WorkingMode[]> {
    const raw = await this.readJson<unknown>('/agent', context)
    const items = Array.isArray(raw) ? raw : []
    return items.map(toWorkingMode)
  }

  /**
   * What this agent does by default.
   */
  async getDefaults(context: ProviderContext): Promise<AgentDefaults> {
    const raw = await this.readJson<unknown>('/config', context)
    return toAgentDefaults(raw)
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

  private async readStatuses(context: ProviderContext): Promise<Map<string, ConversationStatus>> {
    const statuses = new Map<string, ConversationStatus>()
    try {
      const raw = await this.client.getJson<Record<string, unknown>>('/session/status', {
        directory: context.directory,
      })
      for (const [id, value] of Object.entries(raw ?? {})) {
        const status = toConversationStatus(value)
        if (status) statuses.set(id, status)
      }
    } catch {
      // The status of a session is a convenience, not the session itself: a
      // server that cannot answer the question must not make the list fail.
    }
    return statuses
  }
}
