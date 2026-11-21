import { z } from 'zod'
import {
  AgentConfigurationSchema,
  AgentDefaultsSchema,
  CommandSchema,
  ConversationStatusSchema,
  McpServerConfigSchema,
  McpServerSchema,
  ProviderAuthMethodsSchema,
  ProviderCredentialListSchema,
  ProviderOAuthAuthorizationSchema,
  ProviderSchema,
  SessionSchema,
  WorkingModeSchema,
} from './v1'

/**
 * The shape the web client talks to.
 *
 * The web client is not a native client and it is not the versioned API's
 * audience either. It wants the list of a person's conversations across every
 * working directory they are allowed to work in, in one answer - so the
 * versioned API's "one agent, one directory, one page" is the wrong unit for
 * it, and a thin layer of its own is the right one.
 *
 * The sessions in here are the versioned API's sessions, because there is one
 * truth about what a session is. What this file adds is the part that is
 * genuinely this layer's own: several directories at once, and a cursor for
 * each of them.
 */

export const BffSessionListResponseSchema = z.object({
  sessions: z.array(SessionSchema),
  /**
   * Where the next page of each directory starts.
   *
   * A directory that has no entry has no more pages: the agent said so, and
   * saying it again would be a lie that costs a round trip.
   */
  cursors: z.record(z.string(), z.string()),
})
export type BffSessionListResponse = z.infer<typeof BffSessionListResponseSchema>

/**
 * How busy every conversation is, across the named directories.
 *
 * The statuses themselves are the versioned API's - there is one truth about
 * how busy a conversation is, and the event stream says it in the same words.
 * What this layer adds is that they come for every directory at once: the
 * client used to ask the agent about each directory separately and merge the
 * answers itself.
 */
export const BffConversationStatusResponseSchema = z.object({
  statuses: z.record(z.string(), ConversationStatusSchema),
})
export type BffConversationStatusResponse = z.infer<typeof BffConversationStatusResponseSchema>

/**
 * The commands the agent knows.
 *
 * The commands themselves are the versioned API's - there is one truth about
 * what a command is - so a client that draws a command palette is drawing the
 * same palette whichever agent is behind it.
 */
export const BffCommandListResponseSchema = z.object({
  commands: z.array(CommandSchema),
})
export type BffCommandListResponse = z.infer<typeof BffCommandListResponseSchema>

/**
 * The ways of working a conversation can be had in.
 *
 * The ways themselves are the versioned API's. What this layer adds is that
 * they come for every working directory at once, the same way the conversation
 * list does.
 */
export const BffWorkingModeListResponseSchema = z.object({
  workingModes: z.array(WorkingModeSchema),
})
export type BffWorkingModeListResponse = z.infer<typeof BffWorkingModeListResponseSchema>

/**
 * What the agent does by default.
 *
 * The defaults are the versioned API's, and they are the only two the client
 * ever reads - the rest of an agent's configuration stays the agent's.
 */
export const BffAgentDefaultsResponseSchema = z.object({
  defaults: AgentDefaultsSchema,
})
export type BffAgentDefaultsResponse = z.infer<typeof BffAgentDefaultsResponseSchema>

/**
 * The models that may be picked.
 *
 * The providers and the models are the versioned API's - there is one truth
 * about what a model is. What this layer adds is that the agent's catalogue
 * is asked once, in one dialect, instead of every place that draws a picker
 * reading the agent's own words and translating them in the browser.
 */
export const BffProviderListResponseSchema = z.object({
  providers: z.array(ProviderSchema),
  /**
   * The model each provider starts on, when it has one.
   *
   * A provider without a default model is not an error: it has models, and
   * the person picks one.
   */
  default: z.record(z.string(), z.string()),
})
export type BffProviderListResponse = z.infer<typeof BffProviderListResponseSchema>

/**
 * The files that match a word.
 *
 * The paths are the agent's own - it knows the working directory they are in
 * - and the layer does not shorten them, because a path that is not the whole
 * path is not a path.
 */
export const BffFileSearchResponseSchema = z.object({
  files: z.array(z.string()),
})
export type BffFileSearchResponse = z.infer<typeof BffFileSearchResponseSchema>

/**
 * The tool servers the agent knows.
 *
 * The servers themselves are the versioned API's - there is one truth about
 * what a tool server is. What this layer adds is that they come for a working
 * directory in one answer, and that what comes back is the server rather than
 * the document the server was written down in.
 *
 * That last part is the whole point: the document holds the credentials of
 * every model provider on the host, and a client that asked for the document
 * asked for those too.
 */
export const BffMcpServerListResponseSchema = z.object({
  servers: z.array(McpServerSchema),
})
export type BffMcpServerListResponse = z.infer<typeof BffMcpServerListResponseSchema>

/**
 * Something the agent has taken on.
 *
 * A change that has been accepted is not a change that has happened: the
 * agent is asked afterwards, and the answer is the one that counts.
 */
export const BffAcceptedResponseSchema = z.object({
  accepted: z.literal(true),
})
export type BffAcceptedResponse = z.infer<typeof BffAcceptedResponseSchema>

/**
 * Adding a tool server.
 *
 * The configuration is the versioned API's - the agent is handed it in its
 * own words - so the client never has to know how the agent spells it.
 */
export const BffAddMcpServerRequestSchema = z.object({
  name: z.string().min(1),
  config: McpServerConfigSchema,
})
export type BffAddMcpServerRequest = z.infer<typeof BffAddMcpServerRequestSchema>

/**
 * How each provider may be logged in.
 *
 * The ways themselves are the versioned API's - there is one truth about what
 * a way of logging in is. What this layer adds is the name: the client asks
 * this layer for the ways, and it does not have to know which agent is behind
 * them or what the agent calls them.
 */
export const BffProviderAuthMethodsResponseSchema = z.object({
  methods: ProviderAuthMethodsSchema,
})
export type BffProviderAuthMethodsResponse = z.infer<typeof BffProviderAuthMethodsResponseSchema>

/**
 * An authorization that has been started.
 *
 * The authorization is the versioned API's: where to go, and what to do there.
 */
export const BffProviderOAuthAuthorizationResponseSchema = z.object({
  authorization: ProviderOAuthAuthorizationSchema,
})
export type BffProviderOAuthAuthorizationResponse = z.infer<
  typeof BffProviderOAuthAuthorizationResponseSchema
>

/**
 * The providers that have credentials.
 *
 * It is a list of names, not of providers: a provider with no credentials is
 * a name, not a way to work.
 */
export const BffProviderCredentialListResponseSchema = z.object({
  credentials: ProviderCredentialListSchema,
})
export type BffProviderCredentialListResponse = z.infer<
  typeof BffProviderCredentialListResponseSchema
>

/**
 * A thing wrong with the configuration.
 */
export const BffConfigurationValidationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
})
export type BffConfigurationValidationIssue = z.infer<
  typeof BffConfigurationValidationIssueSchema
>

/**
 * One file the configuration is written down in.
 *
 * Which files those are is the agent's business, so the layer says "a source"
 * and not a file name: a client that has to learn the file names of every
 * agent has to learn them again for each one.
 */
export const BffConfigurationSourceSchema = z.object({
  name: z.string(),
  path: z.string(),
  /**
   * The file as it is written down, with every credential behind a word.
   */
  rawContent: z.string(),
  /**
   * The same file, read as a document, with every credential behind a word.
   */
  content: z.record(z.string(), z.unknown()),
  isValid: z.boolean(),
  validationIssues: z.array(BffConfigurationValidationIssueSchema).optional(),
  updatedAt: z.number(),
})
export type BffConfigurationSource = z.infer<typeof BffConfigurationSourceSchema>

/**
 * The configuration, as this layer says it.
 *
 * This is the agent's own face - the last of it - and it is the one document
 * that holds the credentials of every model provider on the host. So it
 * travels with holes in it: every credential is the word that stands for one,
 * and the path it was at is kept, because the server puts its own value back
 * where its own value was.
 *
 * The revision is the revision of the document on disk, not of the masked one:
 * a client that sends it back is saying "this is what I read", and the
 * server has to be able to tell whether what is on disk is still that.
 */
export const BffConfigurationDocumentSchema = z.object({
  path: z.string(),
  content: z.record(z.string(), z.unknown()),
  rawContent: z.string(),
  isValid: z.boolean(),
  validationIssues: z.array(BffConfigurationValidationIssueSchema).optional(),
  updatedAt: z.number(),
  sources: z.array(BffConfigurationSourceSchema),
  revision: z.string(),
})
export type BffConfigurationDocument = z.infer<typeof BffConfigurationDocumentSchema>

export const BffConfigurationResponseSchema = z.object({
  configuration: BffConfigurationDocumentSchema,
})
export type BffConfigurationResponse = z.infer<typeof BffConfigurationResponseSchema>

/**
 * The configuration after a change.
 *
 * `restartRequired` says that the agent is not running the configuration that
 * was just written down - the change is on disk, and the agent has not read
 * it again yet.
 *
 * `overriddenCredentials` names the places where the client tried to change a
 * credential - by writing a value of its own, or by removing the line - and the
 * server's own value went back there instead. They are named so that the
 * person can be told: an edit that quietly does not happen is worse than one
 * that is refused, because the person believes they changed something and they
 * did not.
 */
export const BffConfigurationSaveResponseSchema = z.object({
  configuration: BffConfigurationDocumentSchema,
  restartRequired: z.boolean().optional(),
  overriddenCredentials: z.array(z.string()).optional(),
})
export type BffConfigurationSaveResponse = z.infer<
  typeof BffConfigurationSaveResponseSchema
>

/**
 * The configuration the agent is actually running with.
 *
 * It is the agent's own answer, so it is the agent's own shape - and it
 * holds the credentials too, so it travels masked like the rest.
 */
export const BffEffectiveConfigurationResponseSchema = z.object({
  configuration: AgentConfigurationSchema,
})
export type BffEffectiveConfigurationResponse = z.infer<
  typeof BffEffectiveConfigurationResponseSchema
>

/**
 * A change to the configuration.
 *
 * The content is either the whole document as a document, or the text of one
 * source file as it is written down. The text is what a person edits, and
 * editing it keeps the comments and the formatting - which is why the server
 * edits the text in place rather than re-serialising it.
 */
export const BffConfigurationUpdateRequestSchema = z.object({
  content: z.union([z.record(z.string(), z.unknown()), z.string()]),
  source: z.string().optional(),
  expectedRevision: z.string().optional(),
})
export type BffConfigurationUpdateRequest = z.infer<
  typeof BffConfigurationUpdateRequestSchema
>

