import { z } from 'zod'
import {
  AcceptedResponseSchema,
  AgentListResponseSchema,
  AgentSchema,
  ApiDescriptorSchema,
  ApiErrorSchema,
  CreateSessionRequestSchema,
  DeletedResponseSchema,
  MessageListResponseSchema,
  MessagePartSchema,
  MessageSchema,
  RenameSessionRequestSchema,
  SendPromptRequestSchema,
  SessionListResponseSchema,
  SessionResponseSchema,
  SessionSchema,
  TokenUsageSchema,
  ToolCallSchema,
} from './v1'

/**
 * A JSON Schema for the versioned API, so a client that is not written in
 * TypeScript can still generate its models from the same source of truth the
 * backend validates against. The backend checks the committed file against
 * this function, so the schema cannot drift away from the shapes.
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
      AgentListResponse: z.toJSONSchema(AgentListResponseSchema),
      SessionListResponse: z.toJSONSchema(SessionListResponseSchema),
      SessionResponse: z.toJSONSchema(SessionResponseSchema),
      MessageListResponse: z.toJSONSchema(MessageListResponseSchema),
      AcceptedResponse: z.toJSONSchema(AcceptedResponseSchema),
      DeletedResponse: z.toJSONSchema(DeletedResponseSchema),
      CreateSessionRequest: z.toJSONSchema(CreateSessionRequestSchema),
      RenameSessionRequest: z.toJSONSchema(RenameSessionRequestSchema),
      SendPromptRequest: z.toJSONSchema(SendPromptRequestSchema),
    },
  }
}
