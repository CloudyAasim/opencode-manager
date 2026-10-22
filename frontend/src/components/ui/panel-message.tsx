import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// "Nothing here" and "that did not work" were both drawn out by hand in every
// tab of the source-control feature - same centred block, same dimmed icon, same
// title, same smaller detail line. Seven copies, and SettingsList had already
// grown its own version of the same thing.
export type PanelMessageTone = 'neutral' | 'error' | 'warning'

const TONE_ICON: Record<PanelMessageTone, string> = {
  neutral: 'text-muted-foreground',
  error: 'text-destructive',
  warning: 'text-warning',
}

/**
 * Two sizes, because a message is not always given a panel to itself.
 *
 * A whole panel that has nothing to show can afford an icon and room to
 * breathe. A scroll box inside a panel cannot - a 32px icon in a log window
 * is a poster, not a line of text. The compact one is a label that still
 * carries a title, a detail and a way out.
 */
const SIZES = {
  md: { wrap: 'gap-0 px-6 py-12', icon: 'mb-3 size-8 [&>svg]:size-8', title: 'text-sm' },
  sm: { wrap: 'gap-0 px-4 py-6', icon: 'mb-2 size-5 [&>svg]:size-5', title: 'text-sm' },
} as const

interface PanelMessageProps {
  icon: ReactNode
  title: ReactNode
  detail?: ReactNode
  action?: ReactNode
  tone?: PanelMessageTone
  size?: keyof typeof SIZES
  className?: string
}

/**
 * The one way this application says "there is nothing here" or "that did not
 * work".
 *
 * KDE's Human principle has a rule that fits this component exactly: a state
 * has to answer three questions. What happened, why, and what the user can
 * do about it. A centred line of text answers the first and leaves the other
 * two to guesswork, so the shape here is fixed - a headline that can be read,
 * a dimmer line underneath, and somewhere to put the way out.
 *
 * The `action` is the third answer, and it used to sit flush against the line
 * above it with no space at all.
 */
export function PanelMessage({
  icon,
  title,
  detail,
  action,
  tone = 'neutral',
  size = 'md',
  className,
}: PanelMessageProps) {
  const sizing = SIZES[size]
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        sizing.wrap,
        className,
      )}
    >
      <div
        className={cn(
          'flex shrink-0 items-center justify-center',
          sizing.icon,
          TONE_ICON[tone],
        )}
      >
        {icon}
      </div>
      <p className={cn('font-medium text-foreground', sizing.title)}>{title}</p>
      {detail && <p className="mt-1 max-w-md text-sm text-muted-foreground">{detail}</p>}
      {action && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  )
}
