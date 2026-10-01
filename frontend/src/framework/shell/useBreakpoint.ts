import { useCallback, useSyncExternalStore } from 'react'
import { layoutForWidth, MEDIA, type BreakpointLayout } from './breakpoints'

const LAYOUT_QUERIES: ReadonlyArray<readonly [BreakpointLayout, string]> = [
  ['wide', MEDIA.expandedUp],
  ['medium', MEDIA.layoutUp],
]

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined
  }
  const queries = LAYOUT_QUERIES.map(([, query]) => window.matchMedia(query))
  queries.forEach((media) => media.addEventListener('change', onChange))
  return () => queries.forEach((media) => media.removeEventListener('change', onChange))
}

function currentWidth(): number {
  return typeof window === 'undefined' ? 0 : window.innerWidth
}

export function useBreakpointLayout(): BreakpointLayout {
  const getWidth = useCallback(currentWidth, [])
  const width = useSyncExternalStore(subscribe, getWidth, () => 0)
  return layoutForWidth(width)
}
