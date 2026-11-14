import { z } from 'zod'
import {
  AgentDefaultsSchema,
  CommandSchema,
  ConversationStatusSchema,
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
