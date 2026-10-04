import { describe, expect, it } from 'vitest'
import { DEFAULTS } from '@opencode-manager/shared/config/defaults'

/**
 * These two numbers are only meaningful together.
 *
 * The heartbeat is what proves the stream is alive. The stall threshold is how
 * long we tolerate silence before calling it dead. At 90s against a 30s
 * heartbeat - three missed beats - a stream that had actually died was still
 * reported connected for a minute and a half, which is how "the status says
 * connected and nothing arrives" kept happening.
 *
 * Pinning 45000 exactly would just be a second place to forget to update. The
 * rule is the relationship: never wait more than two heartbeats before noticing
 * the stream is gone.
 */
describe('SSE timing defaults', () => {
  const { HEARTBEAT_INTERVAL_MS, STALL_THRESHOLD_MS, WATCHDOG_TICK_MS, CONNECT_TIMEOUT_MS } =
    DEFAULTS.SSE

  it('notices a dead stream within two heartbeats', () => {
    expect(STALL_THRESHOLD_MS).toBeLessThanOrEqual(HEARTBEAT_INTERVAL_MS * 2)
  })

  it('still waits longer than one heartbeat, so jitter is not a reconnect', () => {
    expect(STALL_THRESHOLD_MS).toBeGreaterThan(HEARTBEAT_INTERVAL_MS)
  })

  it('checks often enough to notice within the stall window', () => {
    // If the watchdog ticked slower than the stall threshold, a stall could sit
    // unnoticed for nearly twice the window before anyone looked.
    expect(WATCHDOG_TICK_MS).toBeLessThan(STALL_THRESHOLD_MS)
  })

  it('gives up on a connect that never opens', () => {
    expect(CONNECT_TIMEOUT_MS).toBeGreaterThan(0)
    expect(CONNECT_TIMEOUT_MS).toBeLessThan(STALL_THRESHOLD_MS)
  })
})
