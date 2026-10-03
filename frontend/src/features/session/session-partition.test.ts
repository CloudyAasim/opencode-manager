import { describe, it, expect } from 'vitest'
import { partitionSessions, parseSessionOrder, formatSessionOrder } from './session-partition'
import type { Session } from '@/api/types'

function createSession(id: string, updated: number, directory = '/test'): Session {
  return {
    id,
    projectID: 'proj-1',
    directory,
    title: `Session ${id}`,
    version: '1',
    time: { created: updated - 10000, updated },
  }
}

const keyFn = (s: { id: string; directory?: string }) =>
  `${s.directory ?? ''}:${s.id}`

describe('partitionSessions', () => {
  it('places pinned sessions in pinned array sorted by updated desc', () => {
    const now = 1_000_000_000_000
    const sessions = [
      createSession('a', now - 2000),
      createSession('b', now - 1000),
      createSession('c', now - 3000),
    ]
    const pinnedKeys = new Set(['/test:a', '/test:c'])

    const result = partitionSessions(sessions, pinnedKeys, keyFn, now)

    expect(result.pinned).toHaveLength(2)
    expect(result.pinned[0].id).toBe('a')
    expect(result.pinned[1].id).toBe('c')
    expect(result.today).toHaveLength(1)
    expect(result.today[0].id).toBe('b')
    expect(result.older).toHaveLength(0)
  })

  it('places unpinned sessions with updated >= start of today in today', () => {
    const now = 1_000_000_000_000
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const todayTs = todayStart.getTime() + 5000
    const yesterdayTs = todayStart.getTime() - 1000

    const sessions = [
      createSession('today-session', todayTs),
      createSession('yesterday-session', yesterdayTs),
    ]

    const result = partitionSessions(sessions, new Set(), keyFn, now)

    expect(result.pinned).toHaveLength(0)
    expect(result.today).toHaveLength(1)
    expect(result.today[0].id).toBe('today-session')
    expect(result.older).toHaveLength(1)
    expect(result.older[0].id).toBe('yesterday-session')
  })

  it('sorts today and older arrays by updated desc', () => {
    const now = 1_000_000_000_000
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const todayTs = todayStart.getTime() + 5000

    const sessions = [
      createSession('older-1', todayStart.getTime() - 3000),
      createSession('older-2', todayStart.getTime() - 1000),
      createSession('today-1', todayTs),
      createSession('today-2', todayTs - 2000),
    ]

    const result = partitionSessions(sessions, new Set(), keyFn, now)

    expect(result.today[0].id).toBe('today-1')
    expect(result.today[1].id).toBe('today-2')
    expect(result.older[0].id).toBe('older-2')
    expect(result.older[1].id).toBe('older-1')
  })

  it('keeps old pinned sessions in pinned (not older)', () => {
    const now = 1_000_000_000_000
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const oldTs = todayStart.getTime() - 86400_000

    const sessions = [
      createSession('pinned-old', oldTs),
      createSession('normal-old', oldTs),
    ]
    const pinnedKeys = new Set(['/test:pinned-old'])

    const result = partitionSessions(sessions, pinnedKeys, keyFn, now)

    expect(result.pinned).toHaveLength(1)
    expect(result.pinned[0].id).toBe('pinned-old')
    expect(result.today).toHaveLength(0)
    expect(result.older).toHaveLength(1)
    expect(result.older[0].id).toBe('normal-old')
  })

  it('returns empty pinned when pinnedKeys is empty, matching today/older behavior', () => {
    const now = 1_000_000_000_000
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const todayTs = todayStart.getTime() + 5000
    const yesterdayTs = todayStart.getTime() - 1000

    const sessions = [
      createSession('today-session', todayTs),
      createSession('yesterday-session', yesterdayTs),
    ]

    const result = partitionSessions(sessions, new Set(), keyFn, now)

    expect(result.pinned).toHaveLength(0)
    expect(result.today).toHaveLength(1)
    expect(result.older).toHaveLength(1)
  })

  it('produces disjoint pinned/today/older arrays', () => {
    const now = 1_000_000_000_000
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const todayTs = todayStart.getTime() + 5000
    const yesterdayTs = todayStart.getTime() - 1000

    const sessions = [
      createSession('pinned', todayTs),
      createSession('normal-today', todayTs - 2000),
      createSession('normal-old', yesterdayTs),
    ]
    const pinnedKeys = new Set(['/test:pinned'])

    const result = partitionSessions(sessions, pinnedKeys, keyFn, now)

    const all = [...result.pinned, ...result.today, ...result.older]
    expect(all).toHaveLength(sessions.length)
    const allIds = all.map((s) => s.id).sort()
    expect(allIds).toEqual(['normal-old', 'normal-today', 'pinned'])
  })
})


/**
 * The list was sorted by time.updated, descending. Recency is a fine default
 * and a bad permanent answer - there was no way to put the session you actually
 * work on at the top, and no way to keep it there.
 *
 * The order applies inside each partition. Dragging must not be able to move a
 * pinned session down into "older": the grouping is a stronger statement than
 * the order, and letting a drag undo it would make both meaningless.
 */
describe('会话顺序', () => {
  const NOW = 1_700_000_000_000
  const ago = (ms: number) => NOW - ms

  const orderedSession = (id: string, updated: number, directory = '/w/a'): Session =>
    ({
      id,
      directory,
      projectID: 'p',
      title: `Session ${id}`,
      time: { created: updated - 10_000, updated },
    } as unknown as Session)

  const orderKey = (s: { id: string; directory?: string }) => `${s.directory ?? '/w/a'}:${s.id}`

  it('存下来的顺序原样读回来', () => {
    expect(parseSessionOrder('/w/a:s2,/w/a:s1')).toEqual(['/w/a:s2', '/w/a:s1'])
    expect(parseSessionOrder(null)).toEqual([])
    expect(parseSessionOrder('')).toEqual([])
    expect(parseSessionOrder(' , /w/a:s1 ,, ')).toEqual(['/w/a:s1'])
    expect(formatSessionOrder(['a', 'b'])).toBe('a,b')
  })

  it('没有存过顺序时还是按最近排', () => {
    const s = [orderedSession('old', ago(90 * 60_000)), orderedSession('new', ago(60_000))]
    const { today } = partitionSessions(s, new Set(), orderKey, NOW)
    expect(today.map(orderKey)).toEqual(['/w/a:new', '/w/a:old'])
  })

  it('存过的顺序说了算', () => {
    const s = [
      orderedSession('a', ago(30_000)),
      orderedSession('b', ago(10_000)),
      orderedSession('c', ago(20_000)),
    ]
    const { today } = partitionSessions(s, new Set(), orderKey, NOW, ['/w/a:c', '/w/a:a', '/w/a:b'])
    expect(today.map(orderKey)).toEqual(['/w/a:c', '/w/a:a', '/w/a:b'])
  })

  it('没被拖过的会话留在后面，不会因为缺席就被挤到底', () => {
    const s = [
      orderedSession('a', ago(30_000)),
      orderedSession('b', ago(10_000)),
      orderedSession('c', ago(20_000)),
    ]
    const { today } = partitionSessions(s, new Set(), orderKey, NOW, ['/w/a:c'])
    expect(today.map(orderKey)).toEqual(['/w/a:c', '/w/a:b', '/w/a:a'])
  })

  it('拖动跨不了分组：置顶的会话不会被拖进"更早"', () => {
    const pinned = new Set(['/w/a:pinned'])
    const s = [
      orderedSession('pinned', ago(30_000)),
      orderedSession('today', ago(60_000)),
      orderedSession('older', ago(3 * 24 * 60 * 60_000)),
    ]
    // the order asked for older first, but the grouping is the stronger claim
    const result = partitionSessions(s, pinned, orderKey, NOW, ['/w/a:older', '/w/a:pinned'])
    expect(result.pinned.map(orderKey)).toEqual(['/w/a:pinned'])
    expect(result.today.map(orderKey)).toEqual(['/w/a:today'])
    expect(result.older.map(orderKey)).toEqual(['/w/a:older'])
  })

  it('id 相同但目录不同的会话各自独立', () => {
    const s = [orderedSession('same', ago(10_000), '/w/a'), orderedSession('same', ago(20_000), '/w/b')]
    const { today } = partitionSessions(s, new Set(), orderKey, NOW, ['/w/b:same', '/w/a:same'])
    expect(today.map(orderKey)).toEqual(['/w/b:same', '/w/a:same'])
  })
})
