import { principalIsAdmin, type Principal } from '../auth/ownership'
import { isWithinRoots } from '../auth/access-scope'
import type { AgentSession } from './agent-session'

/**
 * Which conversations a person may see.
 *
 * OpenCode files a conversation under a *project*, and a project is
 * identified by the git origin of the checkout it was opened in
 * (`git-remote:<host>/<path>`, hashed). Two people who cloned the same
 * repository therefore share one project, and the project is what the
 * session list is scoped to - so the list of conversations in
 * `/workspace/users/alice/workspace/repos/Thing` is the same list as the
 * one in `/workspace/users/bob/workspace/repos/Thing`.
 *
 * The manager is what has to undo that, because it is the only thing that
 * knows who asked for a conversation. The ledger (`ocm_agent_session`)
 * records that at the moment the session comes into existence.
 *
 * The rule, in order:
 *
 * 1. The ledger knows the session: the ledger's owner decides. Not the
 *    directory - a conversation can sit in one person's checkout and still
 *    belong to another (an administrator opening someone's repository
 *    leaves their own conversation there, and that conversation is not the
 *    repository owner's business).
 * 2. The ledger does not know the session: a conversation from before the
 *    ledger existed. The directory it was created in is the only thing
 *    left to go on.
 * 3. An administrator sees everything, as everywhere else in the app.
 */

export interface SessionSummary {
  id: string
  directory?: string | null
}

/**
 * The identifier of a conversation, wherever it is written down.
 *
 * Both spellings of the API are in use: the older one carries the fields
 * on the conversation itself, the newer one nests the place in `location`.
 */
export function sessionIdOf(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null
  const id = (item as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

/**
 * The directory a conversation was created in.
 *
 * The older API says so directly; the newer one says it in `location`.
 * Both are read, because a list that only understood one of them would
 * quietly treat every conversation of the other kind as having no place -
 * and a conversation with no place belongs to nobody, which is a different
 * answer from "not yours".
 */
export function sessionDirectoryOf(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null
  const record = item as { directory?: unknown; location?: { directory?: unknown } | null }
  const nested = record.location?.directory
  if (typeof nested === 'string') return nested
  if (typeof record.directory === 'string') return record.directory
  return null
}

/**
 * The conversation a pending permission or a pending question belongs to.
 */
export function requestSessionIdOf(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null
  const sessionID = (item as { sessionID?: unknown }).sessionID
  return typeof sessionID === 'string' ? sessionID : null
}

export function sessionVisibleTo(
  session: SessionSummary,
  record: AgentSession | null | undefined,
  principal: Principal | null,
  roots: readonly string[],
): boolean {
  if (!principal) return false
  if (principalIsAdmin(principal)) return true

  if (record) {
    // The ledger's owner is the answer, even when the session sits in a
    // directory the other person can also reach.
    return record.userId === principal.id
  }

  if (!session.directory) return false
  return isWithinRoots(session.directory, roots)
}

/** The conversations of a list that this person may see. */
export function visibleSessions<T extends SessionSummary>(
  sessions: readonly T[],
  records: ReadonlyMap<string, AgentSession>,
  principal: Principal | null,
  roots: readonly string[],
): T[] {
  if (principalIsAdmin(principal)) return [...sessions]
  return sessions.filter((session) =>
    sessionVisibleTo(session, records.get(session.id), principal, roots),
  )
}

/**
 * Whether a conversation is this person's to touch.
 *
 * The ledger answers when it knows the conversation. When it does not, the
 * only thing left is the directory the conversation was created in, and
 * finding that out means asking the upstream - so the caller supplies the
 * lookup, and a lookup that fails counts as "not yours". A question whose
 * answer cannot be established has to be a "no": the answer has to be "yes,
 * it is yours" before anything is forwarded.
 */
export async function sessionBelongsToCaller(
  sessionId: string,
  record: AgentSession | null | undefined,
  principal: Principal | null,
  roots: readonly string[],
  resolveDirectory: (sessionId: string) => Promise<string | null>,
): Promise<boolean> {
  if (!principal) return false
  if (principalIsAdmin(principal)) return true

  if (record) return record.userId === principal.id

  const directory = await resolveDirectory(sessionId)
  if (!directory) return false
  return isWithinRoots(directory, roots)
}
