import { describe, it, expect } from 'vitest'
import { withToggledPin } from './sessionPins'
import type { SessionPin } from '@opencode-manager/shared/schemas'

const pin = (sessionId: string, directory = '/w/a', pinnedAt = 1): SessionPin => ({
  sessionId,
  directory,
  pinnedAt,
})

describe('withToggledPin', () => {
  it('adds a pin that was not there', () => {
    const result = withToggledPin([], { sessionId: 's1', directory: '/w/a', pinned: true }, 99)
    expect(result).toEqual([{ sessionId: 's1', directory: '/w/a', pinnedAt: 99 }])
  })

  it('removes a pin that was there', () => {
    const before = [pin('s1'), pin('s2')]
    const result = withToggledPin(before, { sessionId: 's1', directory: '/w/a', pinned: false }, 99)
    expect(result.map((p) => p.sessionId)).toEqual(['s2'])
  })

  it('treats the same session id in another directory as another session', () => {
    const before = [pin('s1', '/w/a')]
    const result = withToggledPin(before, { sessionId: 's1', directory: '/w/b', pinned: true }, 99)
    expect(result).toHaveLength(2)
    expect(result[1].directory).toBe('/w/b')
  })

  it('leaves the pins it did not touch alone', () => {
    const before = [pin('s1', '/w/a', 5)]
    const result = withToggledPin(before, { sessionId: 's2', directory: '/w/a', pinned: true }, 99)
    expect(result[0]).toBe(before[0])
  })

  it('stamps a new pin with the time it was asked for', () => {
    const result = withToggledPin([], { sessionId: 's1', directory: '/w/a', pinned: true }, 1234)
    expect(result[0].pinnedAt).toBe(1234)
  })

  it('returns the same array when the session is already in that state', () => {
    const alreadyPinned = [pin('s1')]
    expect(
      withToggledPin(alreadyPinned, { sessionId: 's1', directory: '/w/a', pinned: true }, 99),
    ).toBe(alreadyPinned)

    const notPinned = [pin('s1')]
    expect(
      withToggledPin(notPinned, { sessionId: 's2', directory: '/w/a', pinned: false }, 99),
    ).toBe(notPinned)
  })
})
