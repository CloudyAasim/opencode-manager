import type { SessionPin, ToggleSessionPinRequest } from '@opencode-manager/shared/schemas'

/**
 * Pinning a session is a change to a list we are already holding, so the row
 * can jump to the top the instant you click and the server can catch up
 * afterwards. Before this it waited for the response, which meant clicking
 * "Pin to top" and watching the row not move.
 *
 * `pinnedAt` is a wall-clock stamp the frontend never reads - partitioning
 * only needs to know *which* sessions are pinned, and ordering inside the
 * pinned group comes from the sessions' own updated time. So a local value is
 * honest here, and the response replaces the whole list anyway.
 *
 * Returns the same array when the toggle would change nothing, so a stale
 * click does not re-render the list.
 */
export function withToggledPin(
  pins: SessionPin[],
  input: ToggleSessionPinRequest,
  now: number,
): SessionPin[] {
  const already = pins.some((pin) => pin.sessionId === input.sessionId && pin.directory === input.directory)
  if (input.pinned === already) return pins
  if (!input.pinned) {
    return pins.filter((pin) => !(pin.sessionId === input.sessionId && pin.directory === input.directory))
  }
  return [...pins, { sessionId: input.sessionId, directory: input.directory, pinnedAt: now }]
}
