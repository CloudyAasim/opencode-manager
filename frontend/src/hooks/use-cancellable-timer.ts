import { useCallback, useEffect, useRef } from 'react'

/**
 * A timer that goes away with the part that owns it.
 *
 * A component that waits for something - two seconds to say "copied", a
 * hundred and fifty milliseconds before it moves to the next question - needs a
 * timer, and the timer needs an owner. When the owner is a bare
 * `setTimeout`, the timer outlives it: the component goes, the timer does not,
 * and it fires into a world that no longer has a window in it. That is how a
 * whole test run turns red over a file that did not fail.
 *
 * So the timer comes from here, and this is the only place in the application
 * that calls `setTimeout` on its own. The part that owns it says when the
 * wait is over; the part says it once.
 */
export interface CancellableTimer {
  /** Wait `delayMs`, then run `task`. A wait that is already running is replaced. */
  schedule: (task: () => void, delayMs: number) => void
  /** Give up on the wait that is running, if there is one. */
  cancel: () => void
}

export function useCancellableTimer(): CancellableTimer {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancel = useCallback(() => {
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const schedule = useCallback(
    (task: () => void, delayMs: number) => {
      cancel()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        task()
      }, delayMs)
    },
    [cancel],
  )

  useEffect(() => cancel, [cancel])

  return { schedule, cancel }
}
