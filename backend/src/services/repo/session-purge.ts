/**
 * Deleting a repository has to delete its conversations too.
 *
 * The conversation is not ours. OpenCode stores sessions and messages under
 * XDG_DATA_HOME, keyed by the working directory, and nothing in the manager's
 * own SQLite database refers to them - the `session` table there holds login
 * tokens, not chats. So `deleteRepoFiles` removed the directory and the row,
 * and every session for that directory stayed exactly where it was.
 *
 * The consequence is the bug this exists to fix: delete a project, add it
 * again, and the old conversations come back, because the new checkout lands
 * on the same path and OpenCode still has the sessions filed under it. Nothing
 * in between said a word.
 *
 * The purge therefore runs *before* the directory is removed. Sessions are
 * filed under a working directory, so purging afterwards risks asking
 * OpenCode about a path it has no context for any more - and an empty list
 * in response to that is indistinguishable from "there was nothing to
 * delete" while the conversations are still sitting on disk. Purging first is
 * the only ordering that cannot produce that false all-clear.
 */

import type { OpenCodeClient } from '../opencode/client'
import { logger } from '../../utils/logger'

/** The two shapes /api/session has used for a page: `data` and `items`. */
interface SessionPageResponse {
  data?: Array<{ id?: unknown }>
  items?: Array<{ id?: unknown }>
  cursor?: { next?: string }
}

export interface PurgeSessionsResult {
  /** Sessions the list reported, across every page. */
  listed: number
  deleted: number
  /** Ids whose delete did not succeed. Never thrown - see below. */
  failed: string[]
  /**
   * True when the page cap stopped the walk before the list ran out. The
   * sessions nobody read are still there, so the caller has to say so rather
   * than report a clean purge.
   */
  truncated: boolean
}

/** The slice of the client this needs, so tests can hand it a fake. */
export type SessionPurgeClient = Pick<OpenCodeClient, 'getJson' | 'forward'>

const DEFAULT_PAGE_SIZE = 100
const DEFAULT_MAX_PAGES = 50

function collectIds(page: SessionPageResponse): string[] {
  const items = page.data ?? page.items ?? []
  return items
    .map((item) => item?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

/**
 * The query rides on the path because that is the only parameter channel
 * `getJson` has; `directory` is set separately by the client and does not
 * clobber it.
 */
function listPath(pageSize: number, cursor: string | undefined): string {
  const query = new URLSearchParams({ limit: String(pageSize), order: 'desc' })
  if (cursor) query.set('cursor', cursor)
  return `/api/session?${query.toString()}`
}

export async function purgeSessionsForDirectory(
  client: SessionPurgeClient,
  directory: string,
  options: { pageSize?: number; maxPages?: number } = {}
): Promise<PurgeSessionsResult> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES

  const result: PurgeSessionsResult = { listed: 0, deleted: 0, failed: [], truncated: false }
  if (!directory) return result

  const seenCursors = new Set<string>()
  let cursor: string | undefined

  for (let page = 0; page < maxPages; page++) {
    let listed: SessionPageResponse
    try {
      listed = await client.getJson<SessionPageResponse>(listPath(pageSize, cursor), { directory })
    } catch (error) {
      // Not being able to *list* is not a reason to refuse the delete the user
      // asked for, but it is emphatically not a clean purge either.
      logger.error(
        `Failed to list OpenCode sessions for ${directory}; their conversations were NOT deleted:`,
        error
      )
      result.truncated = true
      return result
    }

    for (const id of collectIds(listed)) {
      result.listed += 1
      try {
        const response = await client.forward({
          method: 'DELETE',
          path: `/session/${encodeURIComponent(id)}`,
          directory,
        })
        if (response.ok) {
          result.deleted += 1
        } else {
          result.failed.push(id)
        }
      } catch (error) {
        // One session that refuses to go must not strand the rest of them.
        logger.error(`Failed to delete OpenCode session ${id} for ${directory}:`, error)
        result.failed.push(id)
      }
    }

    const next = listed.cursor?.next
    if (!next) return result
    // A cursor that repeats would otherwise walk the same page until the cap,
    // deleting nothing new and reporting progress.
    if (seenCursors.has(next)) {
      logger.warn(`OpenCode session cursor for ${directory} repeated; stopping the walk`)
      result.truncated = true
      return result
    }
    seenCursors.add(next)
    cursor = next
  }

  result.truncated = true
  return result
}
