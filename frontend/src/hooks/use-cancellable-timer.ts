import { useCallback, useEffect, useRef } from 'react'

/**
 * A timer that goes away with the part that owns it.
 *
 * A component that waits for something - two seconds to say "copied", a
 * hundred and fifty milliseconds before it moves to the next question, three
 * seconds before it stops highlighting a line - needs a timer, and the timer
 * needs an owner. When the owner is a bare `setTimeout`, the timer outlives
 * it: the component goes, the timer does not, and it fires into a world that
 * no longer has a window in it. That is how a whole test run turns red over
 * a file that did not fail.
 *
 * So the timer comes from here, and this is the only place in the application
 * that calls `setTimeout` on its own.
 *
 * Every wait has a name. Two waits with different names are two different
 * waits and they do not disturb each other - a part can be waiting for the
 * user to finish copying *and* for the question to move on, and neither one
 * may cancel the other. Two waits with the same name are the same wait: the
 * second one replaces the first, because a part that says "wait again" means
 * "forget the last one".
 */
export interface CancellableTimer {
  /**
   * Wait `delayMs`, then run `task`.
   *
   * A wait under the same name is replaced; waits under other names are left
   * alone.
   */
  schedule: (name: string, task: () => void, delayMs: number) => void
  /** Give up on the wait under `name`, if there is one. */
  cancel: (name: string) => void
  /** Whether a wait under `name` is still running. */
  pending: (name: string) => boolean
}

export function useCancellableTimer(): CancellableTimer {
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const cancel = useCallback((name: string) => {
    const handle = timersRef.current.get(name)
    if (handle === undefined) return
    clearTimeout(handle)
    timersRef.current.delete(name)
  }, [])

  const schedule = useCallback(
    (name: string, task: () => void, delayMs: number) => {
      cancel(name)
      timersRef.current.set(
        name,
        setTimeout(() => {
          timersRef.current.delete(name)
          task()
        }, delayMs),
      )
    },
    [cancel],
  )

  const pending = useCallback((name: string) => timersRef.current.has(name), [])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const handle of timers.values()) clearTimeout(handle)
      timers.clear()
    }
  }, [])

  return { schedule, cancel, pending }
}
