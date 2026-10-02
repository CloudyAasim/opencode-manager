import { useEffect, useRef } from 'react'

// Where a feature-owned action goes so the dispatcher can reach it.
//
// The page owns navigation, so it hands its actions to useKeyboardShortcuts
// directly. An action whose behaviour lives inside a feature - cycling model
// variants, say - cannot travel that way without pointing the page at
// something it does not own, so it registers here instead and the dispatcher
// falls back to this table when the page has nothing for that action.

const handlers = new Map<string, () => void>()

export function getShortcutAction(action: string): (() => void) | undefined {
  return handlers.get(action)
}

export function useShortcutAction(action: string, run: () => void): void {
  const runRef = useRef(run)
  runRef.current = run

  useEffect(() => {
    const handler = () => runRef.current()
    handlers.set(action, handler)
    return () => {
      if (handlers.get(action) === handler) handlers.delete(action)
    }
  }, [action])
}
