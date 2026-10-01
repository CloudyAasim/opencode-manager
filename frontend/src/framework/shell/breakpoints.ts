export const BREAKPOINT = {
  compact: 640,
  layout: 768,
  expanded: 1024,
} as const

export type BreakpointName = keyof typeof BREAKPOINT

export const MEDIA = {
  compactUp: `(min-width: ${BREAKPOINT.compact}px)`,
  layoutUp: `(min-width: ${BREAKPOINT.layout}px)`,
  expandedUp: `(min-width: ${BREAKPOINT.expanded}px)`,
  belowLayout: `(max-width: ${BREAKPOINT.layout - 1}px)`,
} as const

export type BreakpointLayout = 'narrow' | 'medium' | 'wide'

export function layoutForWidth(width: number): BreakpointLayout {
  if (width >= BREAKPOINT.expanded) return 'wide'
  if (width >= BREAKPOINT.layout) return 'medium'
  return 'narrow'
}
