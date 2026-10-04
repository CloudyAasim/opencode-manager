import type { Database } from 'bun:sqlite'

/**
 * Which OpenCode session belongs to whom.
 *
 * The internal API is reached by the `ocm` tool with one global bearer token,
 * so a token alone says "this is our plugin" and nothing about who is calling.
 * This table is the other half. The manager creates every OpenCode session
 * itself, so at the moment a session comes into existence it knows who asked
 * for it, and the plugin reports the session id it is running in. Pairing those
 * two is what lets the internal API answer "which tenant is this" instead of
 * "is this token shaped right".
 *
 * Staged rollout. Nothing reads this table yet - the internal middleware still
 * accepts a bare token and behaves exactly as before - but it is written from
 * day one so that turning enforcement on later is switching one branch rather
 * than inventing the data under pressure.
 *
 * `directory` is recorded for auditing only. It is deliberately not the
 * identity: scheduled runs execute under `/workspace/schedule-worktrees/...`
 * and shared repositories under `/workspace/repos/...`, neither of which
 * contains a user name, so a directory cannot answer this question for every
 * session.
 */

export type AgentSessionSource = 'proxy' | 'schedule'

/**
 * `unknown` is a recorded fact, not a third kind of user. It means the row
 * exists but no person could be attributed to it - a schedule against a
 * repository with no owner. Anything enforcing access has to treat it as "no
 * identity", because that is exactly what it is.
 */
export type AgentSessionRole = 'admin' | 'user' | 'unknown'

export interface AgentSessionIdentity {
  userId: string | null
  username: string | null
  role: AgentSessionRole
}

export interface AgentSessionInput extends AgentSessionIdentity {
  sessionId: string
  directory: string | null
  source: AgentSessionSource
}

export interface AgentSession extends AgentSessionInput {
  createdAt: number
}

interface AgentSessionRow {
  session_id: string
  user_id: string | null
  username: string | null
  role: string
  directory: string | null
  source: string
  created_at: number
}

export const UNKNOWN_IDENTITY: AgentSessionIdentity = Object.freeze({
  userId: null,
  username: null,
  role: 'unknown',
})

/**
 * A scheduled run has no signed-in user behind it - cron fired it. The one
 * person it can be attributed to is the owner of the repository it runs
 * against, which is the only link a job has: `schedule_jobs` stores `repo_id`
 * and nothing about who created the job.
 */
export function resolveRepoOwnerIdentity(db: Database, repoId: number): AgentSessionIdentity {
  const row = db
    .prepare(
      `SELECT u.id AS id, u.username AS username, u.role AS role
         FROM repos r LEFT JOIN "user" u ON u.id = r.user_id
        WHERE r.id = ?`,
    )
    .get(repoId) as { id: string | null; username: string | null; role: string | null } | undefined

  // A repository with no owner, or one whose owner row is gone, yields no
  // person. Reporting that honestly is the point: an invented identity would
  // hand the session to whoever happens to hold a matching id.
  if (!row?.id) return { ...UNKNOWN_IDENTITY }

  return {
    userId: row.id,
    username: row.username ?? null,
    role: row.role === 'admin' ? 'admin' : 'user',
  }
}

export function recordAgentSession(db: Database, input: AgentSessionInput): AgentSession {
  const createdAt = Date.now()
  // OR REPLACE, not OR IGNORE: a session id already recorded with the wrong
  // owner is worse than no row at all, and re-running the same job reuses it.
  db.prepare(
    `INSERT OR REPLACE INTO ocm_agent_session
       (session_id, user_id, username, role, directory, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.sessionId,
    input.userId,
    input.username,
    input.role,
    input.directory,
    input.source,
    createdAt,
  )

  return { ...input, createdAt }
}

export function findAgentSession(db: Database, sessionId: string): AgentSession | null {
  const row = db
    .prepare('SELECT * FROM ocm_agent_session WHERE session_id = ?')
    .get(sessionId) as AgentSessionRow | undefined
  if (!row) return null

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    username: row.username,
    role: row.role as AgentSessionRole,
    directory: row.directory,
    source: row.source as AgentSessionSource,
    createdAt: row.created_at,
  }
}
