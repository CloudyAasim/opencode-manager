import { z } from 'zod'
import { SessionSchema } from './v1'

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
