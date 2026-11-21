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

/**
 * The words a failure is said in.
 *
 * The vocabulary is small on purpose: a client that has to learn a code per
 * kind of failure has to learn a lot to say little. What the code cannot say
 * - which thing was missing, under which name - is said in the message, and
 * in the details when a program needs to read it.
 *
 * `not_found` is the conversation that is not there, and `agent_not_found` is
 * the agent that is not registered. `resource_not_found` is for everything
 * else that can be named and then not be there: a tool server, a permission
 * that somebody else answered, a question that was withdrawn. It was given a
 * code of its own rather than sharing `not_found` because a client that was
 * told "no conversation" would go looking for the conversation.
 *
 * `conflict` is for a change that cannot be made because the world moved
 * under it: somebody else wrote the same thing first. It has a code of its
 * own because the way out of it is not to fix the request - the request was
 * fine - but to read again and try once more.
 */
export const ApiErrorCodeSchema = z.enum([
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'resource_not_found',
  'agent_not_found',
  'agent_unavailable',
  'conflict',
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

/**
 * What was missing, when what is missing is a thing that has a name.
 *
 * The kind of thing is this dialect's word for it, not the agent's: the agent
 * calls its tool servers "mcp servers", and a client that has to learn two
 * names for one thing has to learn one of them twice.
 */
export const MissingResourceSchema = z.object({
  /** This dialect's word for the kind of thing that is not there. */
  resource: z.string(),
  /** The name it was known by, when it was known by one. */
  id: z.string().optional(),
})
export type MissingResource = z.infer<typeof MissingResourceSchema>

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
 * How busy a conversation is right now.
 *
 * This is not the same word as the session's own `status` field, and the
 * difference is worth keeping rather than flattening. The field says what was
 * true when the conversation was last written down; this says what is
 * happening at this moment. A conversation that is trying again says so here,
 * and says when it will try again - which the field has no room for.
 *
 * The two are asked of the same place and travel together: the event stream
 * says one and the answer says the other, and a client that holds both must
 * not have to know which dialect it is holding.
 */
export const ConversationStatusSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('idle') }),
  z.object({ type: z.literal('busy') }),
  z.object({
    type: z.literal('retry'),
    attempt: z.number(),
    message: z.string(),
    next: z.number(),
  }),
])
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>

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
 * A task the agent has written down for itself.
 *
 * Where the task stands and how urgent it is are the agent's own words: it
 * says "pending", "in_progress", "completed" and "cancelled" today, and it is
 * free to say something else tomorrow. So they are its words and not a list
 * this layer believes in - a layer that believed in a list would have to
 * invent an answer for a word it had not heard, and the list would be a
 * promise the agent never made.
 *
 * A task has no name of its own here either, and that is not an oversight.
 * The agent's own specification says a task carries an id, but the agent that
 * is actually running has never sent one - not in the list it keeps, not in
 * the tool call it writes that list with. So there is no id to carry across
 * and none is made up: a task is what it says, and where it stands.
 */
export const TodoSchema = z.object({
  /** What the task is. */
  content: z.string(),
  /** The agent's own word for where the task stands. */
  status: z.string(),
  /** The agent's own word for how urgent the task is. */
  priority: z.string(),
})
export type Todo = z.infer<typeof TodoSchema>

/**
 * A tool call, and how far it got.
 *
 * The call is named and numbered, and the state says where it got to: a call
 * that is still running has no output yet, a call that failed says why, and a
 * call that was never answered is still pending.
 *
 * What the tool was called with, and what it left behind, is the agent's own
 * - a tool is called with whatever its caller decided to call it with - so
 * those two are open. What a tool leaves behind that this layer knows how to
 * say is not open: a task list is said in this layer's words, in the tool
 * call that wrote it, so that a client reading the conversation and a client
 * watching it are told about the same tasks in the same words.
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
    /**
     * The tasks this call wrote down, in this layer's words.
     *
     * Null when the call wrote no tasks this layer knows how to say: a call
     * that is not about tasks, or one whose agent keeps its tasks in words
     * this layer has not learned yet.
     */
    todos: z.array(TodoSchema).nullable(),
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
  /**
   * The name of the working mode that answered, when the answer came from one.
   *
   * This is the name, not the mode itself: what a mode is - its description,
   * what it can be used for - is said by the working modes themselves, and a
   * message only needs to say which one answered.
   */
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

/**
 * What to do about a permission request.
 *
 * Three answers, and they are the three a person can give: allow it this
 * once, allow it from now on, or refuse it.
 */
export const PermissionResponseSchema = z.enum(['once', 'always', 'reject'])
export type PermissionResponse = z.infer<typeof PermissionResponseSchema>

/** The answer to a permission request. */
export const PermissionReplySchema = z.object({
  reply: PermissionResponseSchema,
})
export type PermissionReply = z.infer<typeof PermissionReplySchema>

/**
 * The answers to a question.
 *
 * A question may be asked in several parts, and each part has its own
 * answers - a question with two parts gets two lists, in the order the parts
 * were asked.
 */
export const QuestionReplySchema = z.object({
  answers: z.array(z.array(z.string())),
})
export type QuestionReply = z.infer<typeof QuestionReplySchema>

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
    /**
     * The name of the working mode that answers, when the caller wants a
     * particular one.
     *
     * A null means the agent picks the one it would have picked anyway.
     */
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

/**
 * The agent's own face: what it can be told to do, the ways it can work, and
 * what it does by default.
 *
 * None of these belong to a conversation - a command is not part of a
 * conversation, and a way of working is not either - but they are said in the
 * versioned dialect for the same reason everything else is: a client that
 * draws a command palette must not have to know which agent drew it, or what
 * that agent calls the thing it drew.
 */

/**
 * A named thing the agent can be told to do.
 *
 * The words it stands for are the agent's own: a command that has no template
 * is one the person types out in full, and one that has a template is one the
 * client fills in for them.
 */
export const CommandSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable(),
  /** The way of working the command runs as. */
  workingMode: z.string().nullable(),
  /** The model the command runs on. */
  model: PromptModelSchema.nullable(),
  /** The words the command stands for, when it has any. */
  template: z.string().nullable(),
  /** Whether the command hands the work to somebody else. */
  subtask: z.boolean(),
  /** What the command is for, in the agent's own words. */
  hints: z.array(z.string()),
})
export type Command = z.infer<typeof CommandSchema>

/**
 * A way of working.
 *
 * The agent can answer a conversation in more than one way, and the ways have
 * names. The versioned API calls them working modes, so that the word "agent"
 * stays free for the program that is doing the work - one agent, many ways.
 */
export const WorkingModeScopeSchema = z.enum(['primary', 'subagent', 'all'])
export type WorkingModeScope = z.infer<typeof WorkingModeScopeSchema>

export const WorkingModeSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable(),
  /**
   * Whether this way can lead a conversation, be handed one, or both.
   *
   * A way of working that can only be handed work is not something a person
   * picks for the conversation they are having.
   */
  scope: WorkingModeScopeSchema,
  /** Whether the way is kept out of the list a person picks from. */
  hidden: z.boolean(),
  /** The colour the way is drawn in, when it has one. */
  color: z.string().nullable(),
  /**
   * The model this way prefers, when it prefers one.
   *
   * A way of working and a model are two different things and the person
   * picks them separately - but a way of working that has its own model says
   * so, and a client that drew the list would be drawing it wrongly if it
   * left that out. So the preference travels with the way.
   */
  model: PromptModelSchema.nullable(),
})
export type WorkingMode = z.infer<typeof WorkingModeSchema>

/**
 * What the agent does by default.
 *
 * Only the two defaults the client actually reads: the model a conversation
 * starts on, and the way of working it starts in. The rest of an agent's
 * configuration is its own business - translating all of it would turn this
 * shape into a report on one agent rather than a word all of them share.
 */
export const AgentDefaultsSchema = z.object({
  model: PromptModelSchema.nullable(),
  /** The name of the way of working a conversation starts in. */
  workingMode: z.string().nullable(),
})
export type AgentDefaults = z.infer<typeof AgentDefaultsSchema>

/**
 * What may be handed to a model, and what it may answer with.
 *
 * The agent's own catalogue says more than this about its models - it says
 * what each of them can read and write, in a vocabulary of its own. What
 * travels here is the part a client draws: the list of what may be given to a
 * model, and the list of what comes back.
 */
export const ModelModalitySchema = z.enum(['text', 'audio', 'image', 'video', 'pdf'])
export type ModelModality = z.infer<typeof ModelModalitySchema>

/**
 * A model somebody can pick.
 *
 * An agent's catalogue is large - thousands of models across hundreds of
 * providers - and most of what it knows about a model is its own business. So
 * this says the four things a client actually asks about: what the model is
 * called, how much it can take in and give back, what it costs, and what it
 * can do.
 *
 * Every one of those may be null: a model that says nothing about its cost is
 * a model whose cost is unknown, not a model that is free.
 */
export const ModelSchema = z.object({
  /** The name the agent knows the model by, inside its provider. */
  id: z.string(),
  name: z.string(),
  /** How much the model can take in, and how much it can say back. */
  limit: z
    .object({
      context: z.number(),
      output: z.number(),
    })
    .nullable(),
  /** What the model costs, per token. */
  cost: z
    .object({
      input: z.number(),
      output: z.number(),
      cacheRead: z.number(),
      cacheWrite: z.number(),
    })
    .nullable(),
  /** What the model can do. */
  capabilities: z
    .object({
      attachment: z.boolean(),
      reasoning: z.boolean(),
      temperature: z.boolean(),
      toolCall: z.boolean(),
    })
    .nullable(),
  /** What may be handed to the model, and what it may answer with. */
  modalities: z
    .object({
      input: z.array(ModelModalitySchema),
      output: z.array(ModelModalitySchema),
    })
    .nullable(),
  /** The other spellings of the same model, when it has any. */
  variants: z.record(z.string(), z.record(z.string(), z.unknown())).nullable(),
})
export type Model = z.infer<typeof ModelSchema>

/**
 * A provider of models.
 *
 * The provider is the thing a model belongs to, and whether it is connected
 * says whether it may be used at all: a provider without its credentials is
 * a name, not a way to work.
 */
export const ProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The environment the provider needs, by name. */
  env: z.array(z.string()),
  models: z.array(ModelSchema),
  /** Whether the provider is ready to be used. */
  connected: z.boolean(),
})
export type Provider = z.infer<typeof ProviderSchema>

/**
 * A question a provider asks before it will let anybody in.
 *
 * It is a question about one thing - a key, a code, a choice - and the answer
 * goes back to the provider as a set of named answers. Which questions there
 * are is the provider's business; that they are asked and answered by name is
 * this layer's.
 *
 * The shape is flat rather than a choice of two: a question that is not a
 * choice has no options, and a question that is always asked has no condition.
 * Saying "none" is one word; making the client ask which of the fields is
 * there is two.
 */
export const PromptFieldSchema = z.object({
  type: z.enum(['text', 'select']),
  /** What the answer is called. */
  key: z.string(),
  /** What the person is asked. */
  message: z.string(),
  /** What the person is shown before they answer. */
  placeholder: z.string().nullable(),
  /** The choices, when it is a choice. */
  options: z.array(z.object({
    label: z.string(),
    value: z.string(),
    /** What else is worth knowing about this choice, when there is anything. */
    hint: z.string().nullable(),
  })).nullable(),
  /**
   * The answer that makes this question asked, when it is asked at all.
   *
   * It is one answer and not a condition: the answer equals the value. The
   * agent spells that with an operator of its own, and this layer does not
   * carry the operator - it carries what the condition means.
   */
  when: z.object({
    key: z.string(),
    value: z.string(),
  }).nullable(),
})
export type PromptField = z.infer<typeof PromptFieldSchema>

/**
 * One way of logging in to a provider.
 *
 * There are two kinds that matter: an API key, which is typed in, and an
 * authorization, which is done somewhere else and comes back as a code. Which
 * of them a provider offers is the provider's business; that they are named
 * the same way everywhere is this layer's.
 */
export const ProviderAuthMethodSchema = z.object({
  type: z.enum(['oauth', 'api']),
  label: z.string(),
  /** What the provider asks before it will let anybody in. */
  prompts: z.array(PromptFieldSchema).nullable(),
})
export type ProviderAuthMethod = z.infer<typeof ProviderAuthMethodSchema>

/**
 * How each provider may be logged in.
 *
 * A provider that is not in here cannot be logged in at all - it is not that
 * it has no methods, it is that it is not a provider anybody may log in to.
 */
export const ProviderAuthMethodsSchema = z.record(z.string(), z.array(ProviderAuthMethodSchema))
export type ProviderAuthMethods = z.infer<typeof ProviderAuthMethodsSchema>

/**
 * An authorization that has been started.
 *
 * The URL is where the person goes, and the method says what happens there:
 * either the provider answers on its own ('auto'), or it hands back a code
 * that has to be pasted in ('code').
 */
export const ProviderOAuthAuthorizationSchema = z.object({
  url: z.string(),
  method: z.enum(['auto', 'code']),
  /** What the person is told to do while they are out. */
  instructions: z.string(),
})
export type ProviderOAuthAuthorization = z.infer<typeof ProviderOAuthAuthorizationSchema>

/**
 * Starting an authorization.
 *
 * The method is which of the provider's ways of logging in is being used - the
 * one in the list, counted from zero - and the answers are what the provider
 * asked for, by name.
 */
export const ProviderOAuthAuthorizeRequestSchema = z.object({
  method: z.number(),
  inputs: z.record(z.string(), z.string()).nullable(),
})
export type ProviderOAuthAuthorizeRequest = z.infer<typeof ProviderOAuthAuthorizeRequestSchema>

/**
 * Finishing an authorization.
 *
 * The code is there only when the provider asked for one; a provider that
 * answers on its own does not have one to give.
 */
export const ProviderOAuthCallbackRequestSchema = z.object({
  method: z.number(),
  code: z.string().nullable(),
})
export type ProviderOAuthCallbackRequest = z.infer<typeof ProviderOAuthCallbackRequestSchema>

/**
 * Why an authorization did not work.
 *
 * These are this layer's words, not the provider's: the provider says what
 * happened in its own names, and this is where those names are translated.
 * A client that is told "the code is missing" can say so; a client that is
 * told a provider's internal tag cannot.
 */
export const ProviderAuthFailureSchema = z.enum([
  'invalid_request',
  'bad_request',
  'authorization_missing',
  'code_missing',
  'callback_failed',
  'validation_failed',
])
export type ProviderAuthFailure = z.infer<typeof ProviderAuthFailureSchema>

/**
 * A provider that may be logged in to, and whether it is.
 *
 * The list is of the providers that have credentials, not of every provider
 * there is: a provider with no credentials is a name, not a way to work.
 */
export const ProviderCredentialListSchema = z.array(z.string())
export type ProviderCredentialList = z.infer<typeof ProviderCredentialListSchema>

/**
 * The state a tool server is in.
 *
 * The agent names five of them and they mean five different things: a server
 * that is connected is one that may be used, a disabled one is one that may
 * not, a failed one is one that tried and could not, and the two that ask for
 * something are waiting for the person to do it.
 *
 * The sixth is what is left when the agent did not say: a server that is
 * written down but was not spoken of. It is not 'connected' and it is not
 * 'failed' - nobody tried.
 */
export const McpServerStateSchema = z.enum([
  'connected',
  'disabled',
  'failed',
  'needs_auth',
  'needs_client_registration',
  'unknown',
])
export type McpServerState = z.infer<typeof McpServerStateSchema>

/**
 * A tool server the agent can talk to.
 *
 * What is here is what a person needs to draw the server and to decide what to
 * do with it: what state it is in, what went wrong when something did, and
 * enough of its shape to know whether it runs here or somewhere else.
 *
 * What is not here is the rest of the agent's configuration. The document a
 * server is configured in also holds the credentials of every model provider
 * on the host, and a client that asks for the document asks for those too.
 * So the client asks for the servers instead, and the secret that belongs to
 * one of them stays where it was written down.
 */
export const McpServerSchema = z.object({
  /** The name the server is configured under. */
  name: z.string(),
  /** What state it is in. */
  state: McpServerStateSchema,
  /** What the agent said went wrong, when it said anything. */
  detail: z.string().nullable(),
  /** Whether it runs on this host as a command, or somewhere else by address. */
  kind: z.enum(['local', 'remote']).nullable(),
  /** The command it runs, when it runs on this host. */
  command: z.array(z.string()).nullable(),
  /** The address it answers on, when it is somewhere else. */
  url: z.string().nullable(),
  /**
   * What it wants to be authorized for.
   *
   * The secret that goes with the client id is not here: the person who starts
   * the authorization is the one who should not have to carry it.
   */
  oauth: z
    .object({
      scope: z.string().nullable(),
      clientId: z.string().nullable(),
    })
    .nullable(),
})
export type McpServer = z.infer<typeof McpServerSchema>

/**
 * How a tool server is to be run.
 *
 * This is what a person says when they add one: a command to run here, or an
 * address to call there. The secret that belongs to an OAuth client is part of
 * it - it is something the person typed, not something the server read out of
 * its own storage - but it is only ever read back out of the document the
 * person wrote it into, and never handed to a client that did not write it.
 */
export const McpServerConfigSchema = z.object({
  /** Whether it runs on this host as a command, or somewhere else by address. */
  kind: z.enum(['local', 'remote']),
  /** Whether it may be used at all. */
  enabled: z.boolean().nullable(),
  /** The command it runs, when it runs on this host. */
  command: z.array(z.string()).nullable(),
  /** The address it answers on, when it is somewhere else. */
  url: z.string().nullable(),
  /** The environment it runs in, when it runs on this host. */
  environment: z.record(z.string(), z.string()).nullable(),
  /** The headers it is called with, when it is somewhere else. */
  headers: z.record(z.string(), z.string()).nullable(),
  /** How long it may take, in milliseconds. */
  timeout: z.number().nullable(),
  /**
   * What it wants to be authorized for.
   *
   * `enabled` says whether authorization is wanted at all; the rest says what
   * it is wanted for. A client that wants a public server leaves the id and
   * the secret out and lets the server register one.
   */
  oauth: z
    .object({
      enabled: z.boolean(),
      scope: z.string().nullable(),
      clientId: z.string().nullable(),
      clientSecret: z.string().nullable(),
    })
    .nullable(),
})
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>

/**
 * A command to be run in a conversation.
 *
 * The words the person typed after the command's name travel with it, because
 * a command that takes an argument and a command that does not are the same
 * request with or without words in it.
 */
export const SendCommandRequestSchema = z.object({
  command: z.string().min(1),
  /** What the person typed after the command's name. */
  arguments: z.string(),
  /** The way of working the command runs as. */
  workingMode: z.string().nullable(),
  /** The model the command runs on. */
  model: PromptModelSchema.nullable(),
})
export type SendCommandRequest = z.infer<typeof SendCommandRequestSchema>

/**
 * A command to be run in a conversation's own shell.
 *
 * The shell belongs to the conversation, so the way of working it runs as is
 * named here - and a command with no way of working named is run as the
 * agent's own default.
 */
export const ShellRequestSchema = z.object({
  command: z.string().min(1),
  /** The way of working the command runs as. */
  workingMode: z.string().nullable(),
})
export type ShellRequest = z.infer<typeof ShellRequestSchema>

/**
 * A conversation to be taken a copy of.
 *
 * The copy can start from a message rather than from the whole conversation,
 * and a copy that starts from the whole conversation says so by naming no
 * message - not by leaving the field out.
 */
export const ForkRequestSchema = z.object({
  /** The message the copy starts from, when it starts from one. */
  messageId: z.string().nullable(),
})
export type ForkRequest = z.infer<typeof ForkRequestSchema>

/**
 * A conversation to be shortened.
 *
 * The model that writes the summary is named, because a summary is an answer
 * and an answer is written by somebody.
 */
export const SummarizeRequestSchema = z.object({
  /** The model that writes the summary. */
  model: PromptModelSchema,
})
export type SummarizeRequest = z.infer<typeof SummarizeRequestSchema>

/**
 * The configuration an agent is running with.
 *
 * The document is the agent's own, so its shape is the agent's: a bag of
 * settings this layer does not get a vote on. What the layer does have a vote
 * on is the credentials in it - they are masked on the way out, and the
 * server's own values win on the way back in.
 *
 * It is a bag and not an object with named keys on purpose. A named key would
 * be a promise that every agent has that key, and the moment a second agent
 * arrives with a key nobody thought of, the promise would be a lie the second
 * agent's clients believed.
 */
export const AgentConfigurationSchema = z.record(z.string(), z.unknown())
export type AgentConfiguration = z.infer<typeof AgentConfigurationSchema>

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
 * How busy a conversation is is here too, and for the same reason: the client
 * is told about it over the stream and asks for it over HTTP, and the two
 * answers have to be the same words or the client is holding two dialects of
 * one thing.
 *
 * The events that are not here are not about the conversation: which version
 * of the program is running. Those say what the agent says about them, and a
 * client that wants them reads them the way the agent says them.
 *
 * What the agent is waiting for is here too, and for the same reason as the
 * list: a client that polled for the permissions and questions it has to
 * answer and then watched the stream change is holding one shape and not two.
 * The stream used to be the one place where the agent's dialect survived into
 * the client - the client had to learn a second dialect to watch the same
 * thing it had already learned one dialect for.
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
    type: z.literal('session.status'),
    properties: z.object({
      sessionId: z.string(),
      status: ConversationStatusSchema,
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
  z.object({
    type: z.literal('todo.updated'),
    properties: z.object({
      sessionId: z.string(),
      todos: z.array(TodoSchema),
    }),
  }),
  z.object({
    type: z.literal('permission.asked'),
    properties: z.object({
      sessionId: z.string(),
      permission: PendingPermissionSchema,
    }),
  }),
  z.object({
    type: z.literal('permission.replied'),
    properties: z.object({
      sessionId: z.string(),
      requestId: z.string(),
      reply: PermissionResponseSchema,
    }),
  }),
  z.object({
    type: z.literal('question.asked'),
    properties: z.object({
      sessionId: z.string(),
      question: PendingQuestionSchema,
    }),
  }),
  z.object({
    type: z.literal('question.replied'),
    properties: z.object({
      sessionId: z.string(),
      requestId: z.string(),
      answers: z.array(z.array(z.string())),
    }),
  }),
  z.object({
    type: z.literal('question.rejected'),
    properties: z.object({
      sessionId: z.string(),
      requestId: z.string(),
    }),
  }),
])
export type ConversationEvent = z.infer<typeof ConversationEventSchema>
