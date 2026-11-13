import type { Database } from 'bun:sqlite'
import type { Session } from '@opencode-manager/shared/api/v1'
import type { AgentProvider } from '../providers/contract'
import { findAgentSession, type AgentSession } from './agent-session'

/**
 * Where a conversation is, and what the ledger knows about it.
 */
export interface SessionLocation {
  /** The conversation, when the agent knows about it. */
  session: Session | null
  /** The working directory it was worked on, when that is known. */
  directory: string | null
  /** What the ledger knows about it. */
  record: AgentSession | null
}

/**
 * Find a conversation without being told where it is.
 *
 * The client used to know: it kept the working directory next to every
 * conversation it had seen and sent it along on every request. That mapping
 * is the server's to keep - the ledger records the directory a conversation
 * was created in - and a client that keeps its own copy of it is a client
 * that is wrong the moment a conversation moves.
 *
 * So the place is worked out here, in three steps, and the first one that
 * answers wins:
 *
 * 1. **The ledger knows.** It recorded the directory at the moment the
 *    conversation came into existence, and it is the authority: a conversation
 *    can sit in one person's checkout and still belong to another.
 * 2. **The agent knows.** Asked about the conversation itself, an agent says
 *    where it was worked on.
 * 3. **The caller's own directories know.** A conversation from before the
 *    ledger existed is looked for in the directories the caller named, and
 *    the one it turns up in is the place it belongs.
 *
 * A conversation none of them knows has no place, and a conversation with no
 * place belongs to nobody - which is a different answer from "not yours".
 */
export async function locateSession(
  database: Database,
  provider: AgentProvider,
  sessionId: string,
  directories: readonly string[],
): Promise<SessionLocation> {
  const record = findAgentSession(database, sessionId)

  if (record?.directory) {
    const session = await provider.getSession(sessionId, { directory: record.directory })
    return { session, directory: record.directory, record }
  }

  // The ledger has nothing to say about the place, so the agent is asked
  // about the conversation itself - with no directory named, because naming
  // one would be guessing.
  const session = await provider.getSession(sessionId, {})

  if (session?.directory) {
    return { session, directory: session.directory, record }
  }

  // The agent did not say either. The caller's own directories are the last
  // thing left to go on.
  for (const directory of directories) {
    const page = await provider.listSessions({ directory })
    if (!page.items.some((item) => item.id === sessionId)) continue
    return {
      session: session ?? (await provider.getSession(sessionId, { directory })),
      directory,
      record,
    }
  }

  return { session, directory: null, record }
}
