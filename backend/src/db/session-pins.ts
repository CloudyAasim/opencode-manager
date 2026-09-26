import { Database } from 'bun:sqlite'

export interface SessionPinRecord {
  sessionId: string
  directory: string
  pinnedAt: number
}

export function ensureSessionPinsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS session_pins (
      session_id TEXT NOT NULL,
      directory TEXT NOT NULL,
      pinned_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, directory)
    )
  `)
}

function whereFor(userId: string | null, includeAll: boolean): { clause: string; params: string[] } {
  if (includeAll || userId === null) return { clause: '', params: [] }
  return { clause: 'WHERE user_id = ?', params: [userId] }
}

export function listSessionPins(db: Database, userId: string | null, includeAll = false): SessionPinRecord[] {
  const { clause, params } = whereFor(userId, includeAll)
  const rows = db
    .prepare(`SELECT session_id, directory, pinned_at FROM session_pins ${clause} ORDER BY pinned_at DESC`)
    .all(...params) as { session_id: string; directory: string; pinned_at: number }[]
  return rows.map((r) => ({ sessionId: r.session_id, directory: r.directory, pinnedAt: r.pinned_at }))
}

export function setSessionPin(
  db: Database,
  sessionId: string,
  directory: string,
  pinned: boolean,
  userId: string | null,
  includeAll = false,
): SessionPinRecord[] {
  const run = db.transaction(() => {
    if (pinned) {
      db.prepare(`
        INSERT INTO session_pins(session_id, directory, pinned_at, user_id)
        VALUES(?,?,?,?)
        ON CONFLICT(session_id, directory) DO UPDATE SET pinned_at=excluded.pinned_at, user_id=excluded.user_id
      `).run(sessionId, directory, Date.now(), userId)
    } else if (userId === null || includeAll) {
      db.prepare('DELETE FROM session_pins WHERE session_id = ? AND directory = ?').run(sessionId, directory)
    } else {
      db.prepare('DELETE FROM session_pins WHERE session_id = ? AND directory = ? AND user_id = ?').run(sessionId, directory, userId)
    }
    return listSessionPins(db, userId, includeAll)
  })
  return run()
}
