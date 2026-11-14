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
  PendingListResponseSchema,
  PendingPermissionSchema,
  PendingQuestionSchema,
  PromptModelSchema,
  RenameSessionRequestSchema,
  SendCommandRequestSchema,
  SendPromptRequestSchema,
  SessionListResponseSchema,
  SessionResponseSchema,
  SessionSchema,
  ShellRequestSchema,
  SummarizeRequestSchema,
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
      SendCommandRequest: z.toJSONSchema(SendCommandRequestSchema),
      ShellRequest: z.toJSONSchema(ShellRequestSchema),
      ForkRequest: z.toJSONSchema(ForkRequestSchema),
      SummarizeRequest: z.toJSONSchema(SummarizeRequestSchema),
    },
  }
}
