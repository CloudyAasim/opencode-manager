import type { Session } from '@/api/types'

export interface PartitionedSessions {
  pinned: Session[]
  today: Session[]
  older: Session[]
}

/**
 * A user's own order, stored as a comma separated list of session keys.
 * Ids are not unique across directories, which is why the key is the same
 * directory+id pair the pinning code already builds.
 */
export function parseSessionOrder(stored: string | null): string[] {
  if (!stored) return []
  return stored.split(',').map((key) => key.trim()).filter(Boolean)
}

export function formatSessionOrder(keys: string[]): string {
  return keys.join(',')
}

/**
 * Apply the user's order to one partition. Sessions the order does not mention
 * keep the recency order and go after the ones it does, so a session that has
 * never been dragged is not pushed to the bottom by being absent.
 */
function applyUserOrder(sessions: Session[], order: string[], keyFn: (s: Session) => string): Session[] {
  if (order.length === 0) return sessions
  const rank = new Map<string, number>()
  order.forEach((key, index) => {
    if (!rank.has(key)) rank.set(key, index)
  })
  return [...sessions].sort((a, b) => {
    const ra = rank.get(keyFn(a))
    const rb = rank.get(keyFn(b))
    if (ra === undefined && rb === undefined) return 0
    if (ra === undefined) return 1
    if (rb === undefined) return -1
    return ra - rb
  })
}

export function partitionSessions(
  sessions: Session[],
  pinnedKeys: Set<string>,
  keyFn: (session: { id: string; directory?: string }) => string,
  now: number = Date.now(),
  userOrder: string[] = [],
): PartitionedSessions {
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const startMs = startOfDay.getTime()
  const byUpdatedDesc = (a: Session, b: Session) => b.time.updated - a.time.updated

  const pinned: Session[] = []
  const today: Session[] = []
  const older: Session[] = []
  for (const s of sessions) {
    if (pinnedKeys.has(keyFn(s))) {
      pinned.push(s)
    } else if (s.time.updated >= startMs) {
      today.push(s)
    } else {
      older.push(s)
    }
  }
  pinned.sort(byUpdatedDesc)
  today.sort(byUpdatedDesc)
  older.sort(byUpdatedDesc)
  return {
    pinned: applyUserOrder(pinned, userOrder, keyFn),
    today: applyUserOrder(today, userOrder, keyFn),
    older: applyUserOrder(older, userOrder, keyFn),
  }
}
