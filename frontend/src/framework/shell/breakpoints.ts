export const BREAKPOINT = {
  compact: 640,
  layout: 768,
  expanded: 1024,
  // Six labelled entries, the title, the repo switcher (capped at 256) and the
  // More button. `expanded` was sized for four labels; this is the width at
  // which all six fit, so the bar spreads out here instead of overflowing
  // between the two.
  spacious: 1280,
} as const


export const MEDIA = {
  compactUp: `(min-width: ${BREAKPOINT.compact}px)`,
  layoutUp: `(min-width: ${BREAKPOINT.layout}px)`,
  expandedUp: `(min-width: ${BREAKPOINT.expanded}px)`,
  spaciousUp: `(min-width: ${BREAKPOINT.spacious}px)`,
  belowLayout: `(max-width: ${BREAKPOINT.layout - 1}px)`,
} as const

export type BreakpointLayout = 'narrow' | 'medium' | 'wide'
