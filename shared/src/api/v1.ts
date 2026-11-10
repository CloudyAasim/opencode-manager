import { z } from 'zod'

/**
 * The shape of the versioned API. This file is the single place where the
 * wire shape is written down: the backend validates every response against
 * these schemas before it leaves, and the JSON Schema generated from them is
 * what a native client (Kotlin, Rust) generates its models from.
 *
 * Nothing in here may name a particular agent. A CLI backend and a server
 * backend both have to be describable by the same words, or the versioned
 * surface stops being a contract and becomes a report on one of them.
 */

export const API_V1_VERSION = 'v1'

export const ApiErrorCodeSchema = z.enum([
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'agent_not_found',
  'agent_unavailable',
  'upstream_error',
  'internal_error',
])
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
})
export type ApiError = z.infer<typeof ApiErrorSchema>

export const AgentKindSchema = z.enum(['server', 'cli'])
export type AgentKind = z.infer<typeof AgentKindSchema>

export const AgentCapabilitySchema = z.enum([
  'sessions',
  'messages',
  'prompts',
  'abort',
  'events',
])
export type AgentCapability = z.infer<typeof AgentCapabilitySchema>

export const AgentStatusSchema = z.enum(['ready', 'degraded', 'unavailable'])
export type AgentStatus = z.infer<typeof AgentStatusSchema>

export const AgentSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: AgentKindSchema,
  capabilities: z.array(AgentCapabilitySchema),
  status: AgentStatusSchema,
})
export type Agent = z.infer<typeof AgentSchema>

export const SessionStatusSchema = z.enum(['idle', 'busy', 'unknown'])
export type SessionStatus = z.infer<typeof SessionStatusSchema>

export const SessionSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  title: z.string(),
  directory: z.string().nullable(),
  /**
   * The working area this session belongs to, when the agent has such a thing.
   *
   * It is not the same as the directory: a directory is a place on this
   * machine, and two checkouts of one repository are two directories and one
   * project. An agent that keeps no such thing says null.
   */
  workspaceId: z.string().nullable(),
  parentId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  archived: z.boolean(),
  status: SessionStatusSchema,
})
export type Session = z.infer<typeof SessionSchema>

export const MessageRoleSchema = z.enum(['user', 'assistant', 'system'])
export type MessageRole = z.infer<typeof MessageRoleSchema>

export const MessagePartTypeSchema = z.enum(['text', 'reasoning', 'tool', 'file', 'other'])
export type MessagePartType = z.infer<typeof MessagePartTypeSchema>

export const ToolCallStateSchema = z.enum(['pending', 'running', 'completed', 'error'])
export type ToolCallState = z.infer<typeof ToolCallStateSchema>

export const ToolCallSchema = z.object({
  name: z.string(),
  state: ToolCallStateSchema,
  title: z.string().nullable(),
  /**
   * What the tool said when it was done. A call without its result is half
   * of the story, and the half that says whether the work actually worked.
   */
  output: z.string().nullable(),
})
export type ToolCall = z.infer<typeof ToolCallSchema>

export const MessagePartSchema = z.object({
  id: z.string(),
  type: MessagePartTypeSchema,
  text: z.string().nullable(),
  tool: ToolCallSchema.nullable(),
})
export type MessagePart = z.infer<typeof MessagePartSchema>

export const TokenUsageSchema = z.object({
  input: z.number(),
  output: z.number(),
  reasoning: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
})
export type TokenUsage = z.infer<typeof TokenUsageSchema>

export const MessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: MessageRoleSchema,
  createdAt: z.number(),
  completedAt: z.number().nullable(),
  parts: z.array(MessagePartSchema),
  cost: z.number().nullable(),
  tokens: TokenUsageSchema.nullable(),
})
export type Message = z.infer<typeof MessageSchema>

export const CreateSessionRequestSchema = z.object({
  title: z.string().min(1).optional(),
  directory: z.string().min(1).optional(),
})
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>

export const RenameSessionRequestSchema = z.object({
  title: z.string().min(1),
})
export type RenameSessionRequest = z.infer<typeof RenameSessionRequestSchema>

export const SendPromptRequestSchema = z.object({
  text: z.string().min(1),
})
export type SendPromptRequest = z.infer<typeof SendPromptRequestSchema>

export const ApiDescriptorSchema = z.object({
  api: z.literal(API_V1_VERSION),
  name: z.string(),
  version: z.string(),
  defaultAgent: z.string().nullable(),
})
export type ApiDescriptor = z.infer<typeof ApiDescriptorSchema>

export const AgentListResponseSchema = z.object({
  agents: z.array(AgentSchema),
})
export type AgentListResponse = z.infer<typeof AgentListResponseSchema>

export const SessionListResponseSchema = z.object({
  sessions: z.array(SessionSchema),
  /**
   * Where the next page starts, or null when this page is the last one.
   *
   * The key is always there even when the value is not: a client that has to
   * ask whether the field exists is a client that will eventually forget to
   * ask, and then it will loop forever over the last page.
   */
  nextCursor: z.string().nullable(),
})
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>

export const SessionResponseSchema = z.object({
  session: SessionSchema,
})
export type SessionResponse = z.infer<typeof SessionResponseSchema>

export const MessageListResponseSchema = z.object({
  messages: z.array(MessageSchema),
})
export type MessageListResponse = z.infer<typeof MessageListResponseSchema>

export const AcceptedResponseSchema = z.object({
  accepted: z.literal(true),
})
export type AcceptedResponse = z.infer<typeof AcceptedResponseSchema>

export const DeletedResponseSchema = z.object({
  deleted: z.literal(true),
  id: z.string(),
})
export type DeletedResponse = z.infer<typeof DeletedResponseSchema>
