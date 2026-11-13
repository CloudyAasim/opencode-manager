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
  /**
   * The agent can be waiting for a permission or for an answer.
   *
   * A program that runs in a terminal has no such thing: nobody is sitting
   * there to answer it, so an agent without this capability says so instead
   * of answering with an empty list that means "nothing is waiting".
   */
  'permissions',
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

/**
 * The message a conversation was rolled back to.
 *
 * A conversation can be undone to one of its messages: everything after that
 * message stops counting. A conversation that was never rolled back says so -
 * "null" and "we were not told" are the same thing here, and both are
 * answerable.
 */
export const SessionRevertSchema = z.object({
  messageId: z.string(),
  partId: z.string().nullable(),
})
export type SessionRevert = z.infer<typeof SessionRevertSchema>

/**
 * Where the conversation can be read by somebody else.
 *
 * A conversation that has been shared has a link; one that has not does not.
 * Both are answerable, so both are said.
 */
export const SessionShareSchema = z.object({
  url: z.string(),
})
export type SessionShare = z.infer<typeof SessionShareSchema>

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
  /**
   * Where the conversation was rolled back to, when it was rolled back.
   */
  revert: SessionRevertSchema.nullable(),
  /**
   * The link somebody else can read the conversation through, when it has one.
   */
  share: SessionShareSchema.nullable(),
})
export type Session = z.infer<typeof SessionSchema>

export const MessageRoleSchema = z.enum(['user', 'assistant', 'system'])
export type MessageRole = z.infer<typeof MessageRoleSchema>

/**
 * The kinds of thing a message is made of.
 *
 * A conversation is not only words. It is the thinking behind the words, the
 * tools that were called, the files that were read, the changes that were
 * proposed, the work that was handed to somebody else. A client that draws a
 * conversation has to be able to tell those apart, so they are named here.
 *
 * They are the parts of a conversation and not the parts of one program: every
 * coding agent has text, reasoning, tools and files, and the words for them
 * are the same wherever the agent comes from.
 */
export const MessagePartTypeSchema = z.enum([
  'text',
  'reasoning',
  'tool',
  'file',
  'patch',
  'agent',
  'subtask',
  'step-start',
  'step-finish',
  'snapshot',
  'retry',
  'compaction',
  'other',
])
export type MessagePartType = z.infer<typeof MessagePartTypeSchema>

export const ToolCallStateSchema = z.enum(['pending', 'running', 'completed', 'error'])
export type ToolCallState = z.infer<typeof ToolCallStateSchema>

/**
 * When something started, and when it stopped.
 *
 * Both are there even when the second one never came: work that is still
 * going on has a beginning and no end yet.
 */
export const TimeRangeSchema = z.object({
  start: z.number(),
  end: z.number().nullable(),
})
export type TimeRange = z.infer<typeof TimeRangeSchema>

/**
 * A tool call, and how far it got.
 *
 * The call is named and numbered, and the state says where it got to: a call
 * that is still running has no output yet, a call that failed says why, and a
 * call that was never answered is still pending.
 *
 * What the tool was called with, and what it left behind, is the agent's own
 * - a tool is called with whatever its caller decided to call it with - so
 * those two are open.
 */
export const ToolCallSchema = z.object({
  callId: z.string(),
  name: z.string(),
  state: z.object({
    status: ToolCallStateSchema,
    title: z.string().nullable(),
    /**
     * What the tool said when it was done. A call without its result is half
     * of the story, and the half that says whether the work actually worked.
     */
    output: z.string().nullable(),
    /** What went wrong, when the call went wrong. */
    error: z.string().nullable(),
    input: z.record(z.string(), z.unknown()).nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    /** The call as it was written down, before it was made sense of. */
    raw: z.string().nullable(),
    time: TimeRangeSchema.nullable(),
  }),
})
export type ToolCall = z.infer<typeof ToolCallSchema>

export const TokenUsageSchema = z.object({
  input: z.number(),
  output: z.number(),
  reasoning: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
})
export type TokenUsage = z.infer<typeof TokenUsageSchema>

/**
 * Why a message failed.
 *
 * These are the kinds of failure a conversation can have, not the classes one
 * program happens to throw: the credentials were refused, the answer was too
 * long, the run was stopped, the upstream said no, or nobody knows.
 */
export const MessageErrorKindSchema = z.enum([
  'authentication',
  'output-length',
  'aborted',
  'api',
  'unknown',
])
export type MessageErrorKind = z.infer<typeof MessageErrorKindSchema>

export const MessageErrorSchema = z.object({
  kind: MessageErrorKindSchema,
  message: z.string(),
  /** Which provider refused, when the failure is about credentials. */
  providerId: z.string().nullable(),
  /** The status the upstream answered with, when it answered with one. */
  statusCode: z.number().nullable(),
  /** Whether trying again could work. */
  isRetryable: z.boolean().nullable(),
})
export type MessageError = z.infer<typeof MessageErrorSchema>

export const TextMessagePartSchema = z.object({
  id: z.string(),
  type: z.literal('text'),
  text: z.string(),
  /** Whether the words were said by the agent or put there by something else. */
  synthetic: z.boolean().nullable(),
  time: TimeRangeSchema.nullable(),
})
export type TextMessagePart = z.infer<typeof TextMessagePartSchema>

export const ReasoningMessagePartSchema = z.object({
  id: z.string(),
  type: z.literal('reasoning'),
  text: z.string(),
  time: TimeRangeSchema.nullable(),
})
export type ReasoningMessagePart = z.infer<typeof ReasoningMessagePartSchema>

export const ToolMessagePartSchema = ToolCallSchema.extend({
  id: z.string(),
  type: z.literal('tool'),
})
export type ToolMessagePart = z.infer<typeof ToolMessagePartSchema>

export const FileMessagePartSchema = z.object({
  id: z.string(),
  type: z.literal('file'),
  filename: z.string().nullable(),
  mime: z.string().nullable(),
  url: z.string(),
})
export type FileMessagePart = z.infer<typeof FileMessagePartSchema>

export const PatchMessagePartSchema = z.object({
  id: z.string(),
  type: z.literal('patch'),
  hash: z.string(),
  files: z.array(z.string()),
})
export type PatchMessagePart = z.infer<typeof PatchMessagePartSchema>

export const AgentMessagePartSchema = z.object({
  id: z.string(),
  type: z.literal('agent'),
  name: z.string(),
})
export type AgentMessagePart = z.infer<typeof AgentMessagePartSchema>

export const SubtaskMessagePartSchema = z.object({
  id: z.string(),
  type: z.literal('subtask'),
  agent: z.string(),
  description: z.string(),
  prompt: z.string(),
  command: z.string().nullable(),
})
export type SubtaskMessagePart = z.infer<typeof SubtaskMessagePartSchema>

export const StepStartMessagePartSchema = z.object({
  id: z.string(),
  type: z.literal('step-start'),
  snapshot: z.string().nullable(),
})
export type StepStartMessagePart = z.infer<typeof StepStartMessagePartSchema>

export const StepFinishMessagePartSchema = z.object({
  id: z.string(),
  type: z.literal('step-finish'),
  reason: z.string(),
  snapshot: z.string().nullable(),
  cost: z.number(),
  tokens: TokenUsageSchema,
})
export type StepFinishMessagePart = z.infer<typeof StepFinishMessagePartSchema>

export const SnapshotMessagePartSchema = z.object({
  id: z.string(),
  type: z.literal('snapshot'),
  snapshot: z.string(),
})
export type SnapshotMessagePart = z.infer<typeof SnapshotMessagePartSchema>

export const RetryMessagePartSchema = z.object({
  id: z.string(),
  type: z.literal('retry'),
  attempt: z.number(),
  error: MessageErrorSchema,
  time: TimeRangeSchema.nullable(),
})
export type RetryMessagePart = z.infer<typeof RetryMessagePartSchema>

export const CompactionMessagePartSchema = z.object({
  id: z.string(),
  type: z.literal('compaction'),
  auto: z.boolean(),
})
export type CompactionMessagePart = z.infer<typeof CompactionMessagePartSchema>

export const OtherMessagePartSchema = z.object({
  id: z.string(),
  type: z.literal('other'),
  text: z.string().nullable(),
})
export type OtherMessagePart = z.infer<typeof OtherMessagePartSchema>

/**
 * One piece of a message.
 *
 * The kind says which of the other fields mean anything: a tool part has a
 * name and a state, a patch part has a hash and a list of files, a piece of
 * reasoning has words and nothing else. A client that switches on the kind
 * knows exactly what it is holding.
 */
export const MessagePartSchema = z.discriminatedUnion('type', [
  TextMessagePartSchema,
  ReasoningMessagePartSchema,
  ToolMessagePartSchema,
  FileMessagePartSchema,
  PatchMessagePartSchema,
  AgentMessagePartSchema,
  SubtaskMessagePartSchema,
  StepStartMessagePartSchema,
  StepFinishMessagePartSchema,
  SnapshotMessagePartSchema,
  RetryMessagePartSchema,
  CompactionMessagePartSchema,
  OtherMessagePartSchema,
])
export type MessagePart = z.infer<typeof MessagePartSchema>

/**
 * One message.
 *
 * The parts are not in here: a message on its own says who said it, when, what
 * it cost and whether it went wrong. The pieces it is made of are asked for
 * separately, because they arrive one at a time while the conversation is
 * happening.
 */
export const MessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: MessageRoleSchema,
  createdAt: z.number(),
  completedAt: z.number().nullable(),
  cost: z.number().nullable(),
  tokens: TokenUsageSchema.nullable(),
  /** Which model answered, when an answer came from one. */
  modelId: z.string().nullable(),
  /** Which provider served the model, when it did. */
  providerId: z.string().nullable(),
  /** Which agent answered, when the answer came from an agent. */
  agent: z.string().nullable(),
  /** Which variant of the model answered, when there are several. */
  variant: z.string().nullable(),
  parentId: z.string().nullable(),
  error: MessageErrorSchema.nullable(),
})
export type Message = z.infer<typeof MessageSchema>

/**
 * A message and the pieces it is made of.
 *
 * This is what a conversation looks like when it is read in one go: the
 * message and everything that belongs to it.
 */
export const MessageWithPartsSchema = z.object({
  info: MessageSchema,
  parts: z.array(MessagePartSchema),
})
export type MessageWithParts = z.infer<typeof MessageWithPartsSchema>

/**
 * The tool call a pending request hangs on.
 *
 * A request can arrive with no tool at all - a question the agent asked by
 * itself - so it is nullable rather than optional: "nothing" and "we were not
 * told" are the same thing here, and both are answerable.
 */
export const PendingRequestToolSchema = z.object({
  messageId: z.string(),
  callId: z.string(),
})
export type PendingRequestTool = z.infer<typeof PendingRequestToolSchema>

/**
 * A permission the agent is waiting for.
 *
 * It belongs to a conversation, so the conversation decides whose it is; the
 * working directory is here so that a caller can tell where the conversation
 * is when the ledger does not know.
 */
export const PendingPermissionSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  directory: z.string().nullable(),
  /** What is being asked permission for. */
  permission: z.string(),
  /** What the permission would allow, as the agent describes it. */
  patterns: z.array(z.string()),
  /** Whatever the agent attached to the request. Open, because it is the agent's. */
  metadata: z.record(z.string(), z.unknown()),
  /** The permissions that would always be allowed after this one. */
  always: z.array(z.string()),
  tool: PendingRequestToolSchema.nullable(),
})
export type PendingPermission = z.infer<typeof PendingPermissionSchema>

export const PendingQuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string().nullable(),
})
export type PendingQuestionOption = z.infer<typeof PendingQuestionOptionSchema>

export const PendingQuestionInfoSchema = z.object({
  question: z.string(),
  /** A very short label for the question. */
  header: z.string(),
  options: z.array(PendingQuestionOptionSchema),
  /** Whether more than one option may be chosen. */
  multiple: z.boolean().default(false),
})
export type PendingQuestionInfo = z.infer<typeof PendingQuestionInfoSchema>

/**
 * A question the agent is waiting for.
 *
 * It belongs to a conversation, so the conversation decides whose it is.
 */
export const PendingQuestionSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  directory: z.string().nullable(),
  questions: z.array(PendingQuestionInfoSchema),
  tool: PendingRequestToolSchema.nullable(),
})
export type PendingQuestion = z.infer<typeof PendingQuestionSchema>

/**
 * Everything the agent is waiting for.
 *
 * One answer for both kinds, because a caller that has to ask twice has to
 * ask twice for every directory it watches.
 */
export const PendingListResponseSchema = z.object({
  permissions: z.array(PendingPermissionSchema),
  questions: z.array(PendingQuestionSchema),
})
export type PendingListResponse = z.infer<typeof PendingListResponseSchema>

export const CreateSessionRequestSchema = z.object({
  title: z.string().min(1).optional(),
  directory: z.string().min(1).optional(),
})
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>

export const RenameSessionRequestSchema = z.object({
  title: z.string().min(1),
})
export type RenameSessionRequest = z.infer<typeof RenameSessionRequestSchema>

export const PromptTextPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
})
export type PromptTextPart = z.infer<typeof PromptTextPartSchema>

export const PromptFilePartSchema = z.object({
  type: z.literal('file'),
  filename: z.string().nullable(),
  mime: z.string().nullable(),
  url: z.string(),
})
export type PromptFilePart = z.infer<typeof PromptFilePartSchema>

/**
 * What is being said to a conversation.
 *
 * A message can be more than words: a file can be handed over with it. The
 * words and the files are told apart by the kind, so a client knows which is
 * which without guessing.
 */
export const PromptPartSchema = z.discriminatedUnion('type', [
  PromptTextPartSchema,
  PromptFilePartSchema,
])
export type PromptPart = z.infer<typeof PromptPartSchema>

/**
 * The model that is asked to answer.
 *
 * A prompt that does not care says nothing about the model, and the agent
 * picks the one it would have picked anyway.
 */
export const PromptModelSchema = z.object({
  providerId: z.string(),
  modelId: z.string(),
})
export type PromptModel = z.infer<typeof PromptModelSchema>

/**
 * What is being said to a conversation.
 *
 * A prompt that says nothing is not a prompt: the request has to carry words
 * or a file to hand over, so a caller who meant to say something cannot end
 * up with an empty turn in the conversation and no idea why.
 */
export const SendPromptRequestSchema = z
  .object({
    parts: z.array(PromptPartSchema).min(1),
    model: PromptModelSchema.nullable(),
    /** Which agent answers, when the caller wants a particular one. */
    agent: z.string().nullable(),
    /** Which variant of that agent answers, when there are several. */
    variant: z.string().nullable(),
  })
  .refine(
    (request) =>
      request.parts.some((part) => part.type === 'file' || part.text.trim().length > 0),
    {
      message:
        'A prompt has to say something: a part with words in it, or a file to hand over.',
    },
  )
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
  messages: z.array(MessageWithPartsSchema),
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

/**
 * What happens to a conversation, said in the versioned dialect.
 *
 * These are the events that carry the conversation itself: a conversation that
 * was made, that changed, that ended, and the messages inside it. Everything
 * here is said in the same words as the shapes above - a session is a session,
 * a message is a message - so a client that read a conversation over HTTP and
 * then watched it change is holding one shape and not two.
 *
 * The events that are not here are not about the shape of a conversation: how
 * busy it is, what it is waiting for, which version of the program is running.
 * Those say what the agent says about them, and a client that wants them reads
 * them the way the agent says them.
 */
export const ConversationEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session.created'),
    properties: z.object({
      sessionId: z.string(),
      session: SessionSchema,
    }),
  }),
  z.object({
    type: z.literal('session.updated'),
    properties: z.object({
      session: SessionSchema,
    }),
  }),
  z.object({
    type: z.literal('session.deleted'),
    properties: z.object({
      sessionId: z.string(),
    }),
  }),
  z.object({
    type: z.literal('session.idle'),
    properties: z.object({
      sessionId: z.string(),
    }),
  }),
  z.object({
    type: z.literal('session.compacted'),
    properties: z.object({
      sessionId: z.string(),
    }),
  }),
  z.object({
    type: z.literal('session.error'),
    properties: z.object({
      sessionId: z.string().nullable(),
      error: MessageErrorSchema.nullable(),
    }),
  }),
  z.object({
    type: z.literal('message.updated'),
    properties: z.object({
      message: MessageSchema,
    }),
  }),
  z.object({
    type: z.literal('message.part.updated'),
    properties: z.object({
      sessionId: z.string(),
      messageId: z.string(),
      part: MessagePartSchema,
    }),
  }),
  z.object({
    type: z.literal('message.part.delta'),
    properties: z.object({
      sessionId: z.string(),
      messageId: z.string(),
      partId: z.string(),
      field: z.string(),
      delta: z.string(),
    }),
  }),
  z.object({
    type: z.literal('message.part.removed'),
    properties: z.object({
      sessionId: z.string(),
      messageId: z.string(),
      partId: z.string(),
    }),
  }),
  z.object({
    type: z.literal('message.removed'),
    properties: z.object({
      sessionId: z.string(),
      messageId: z.string(),
    }),
  }),
])
export type ConversationEvent = z.infer<typeof ConversationEventSchema>
