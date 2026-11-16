import { z } from 'zod'
import {
  AcceptedResponseSchema,
  AgentDefaultsSchema,
  AgentListResponseSchema,
  AgentSchema,
  ApiDescriptorSchema,
  ApiErrorSchema,
  CommandSchema,
  ConversationEventSchema,
  ConversationStatusSchema,
  CreateSessionRequestSchema,
  DeletedResponseSchema,
  ForkRequestSchema,
  MessageListResponseSchema,
  MessagePartSchema,
  MessageSchema,
  McpServerConfigSchema,
  McpServerSchema,
  McpServerStateSchema,
  ModelModalitySchema,
  ModelSchema,
  PendingListResponseSchema,
  PendingPermissionSchema,
  PendingQuestionSchema,
  PromptModelSchema,
  ProviderSchema,
  RenameSessionRequestSchema,
  SendCommandRequestSchema,
  SendPromptRequestSchema,
  SessionListResponseSchema,
  SessionResponseSchema,
  SessionSchema,
  ShellRequestSchema,
  SummarizeRequestSchema,
  TodoSchema,
  TokenUsageSchema,
  ToolCallSchema,
  WorkingModeSchema,
} from './v1'

/**
 * A JSON Schema for the versioned API, so a client that is not written in
 * TypeScript can still generate its models from the same source of truth the
 * backend validates against. The backend checks the committed file against
 * this function, so the schema cannot drift away from the shapes.
 *
 * Everything the versioned API answers with is here, not only the answers
 * that come over HTTP: the event stream is part of the same surface, and a
 * client that watches a conversation change needs the shape of what it is
 * told.
 */
export function buildV1JsonSchema(): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'opencode-manager v1',
    description:
      'The versioned JSON API of the manager. Every payload is one of these shapes; nothing in them names a particular agent.',
    $defs: {
      ApiError: z.toJSONSchema(ApiErrorSchema),
      ApiDescriptor: z.toJSONSchema(ApiDescriptorSchema),
      Agent: z.toJSONSchema(AgentSchema),
      Session: z.toJSONSchema(SessionSchema),
      Message: z.toJSONSchema(MessageSchema),
      MessagePart: z.toJSONSchema(MessagePartSchema),
      ToolCall: z.toJSONSchema(ToolCallSchema),
      TokenUsage: z.toJSONSchema(TokenUsageSchema),
      // The tasks the agent writes down for itself. They are part of the
      // conversation - a call that wrote them carries them - so a client that
      // is told about a tool call is told about the tasks it wrote.
      Todo: z.toJSONSchema(TodoSchema),
      ConversationStatus: z.toJSONSchema(ConversationStatusSchema),
      ConversationEvent: z.toJSONSchema(ConversationEventSchema),
      PendingPermission: z.toJSONSchema(PendingPermissionSchema),
      PendingQuestion: z.toJSONSchema(PendingQuestionSchema),
      AgentListResponse: z.toJSONSchema(AgentListResponseSchema),
      SessionListResponse: z.toJSONSchema(SessionListResponseSchema),
      SessionResponse: z.toJSONSchema(SessionResponseSchema),
      MessageListResponse: z.toJSONSchema(MessageListResponseSchema),
      PendingListResponse: z.toJSONSchema(PendingListResponseSchema),
      AcceptedResponse: z.toJSONSchema(AcceptedResponseSchema),
      DeletedResponse: z.toJSONSchema(DeletedResponseSchema),
      CreateSessionRequest: z.toJSONSchema(CreateSessionRequestSchema),
      RenameSessionRequest: z.toJSONSchema(RenameSessionRequestSchema),
      SendPromptRequest: z.toJSONSchema(SendPromptRequestSchema),
      PromptModel: z.toJSONSchema(PromptModelSchema),
      Command: z.toJSONSchema(CommandSchema),
      WorkingMode: z.toJSONSchema(WorkingModeSchema),
      AgentDefaults: z.toJSONSchema(AgentDefaultsSchema),
      // The catalogue of models. It is not an answer of the versioned API's
      // own endpoints yet, but it is the versioned API's language - and a
      // client that is told about a Model and a Provider but not about what
      // they are has been told half the truth.
      ModelModality: z.toJSONSchema(ModelModalitySchema),
      Model: z.toJSONSchema(ModelSchema),
      Provider: z.toJSONSchema(ProviderSchema),
      // The tool servers. Like the catalogue, they are the versioned API's
      // language rather than one of its own endpoints - but a client that is
      // told about a server and not about how it is run has been told half
      // the truth.
      McpServerState: z.toJSONSchema(McpServerStateSchema),
      McpServer: z.toJSONSchema(McpServerSchema),
      McpServerConfig: z.toJSONSchema(McpServerConfigSchema),
      SendCommandRequest: z.toJSONSchema(SendCommandRequestSchema),
      ShellRequest: z.toJSONSchema(ShellRequestSchema),
      ForkRequest: z.toJSONSchema(ForkRequestSchema),
      SummarizeRequest: z.toJSONSchema(SummarizeRequestSchema),
    },
  }
}
