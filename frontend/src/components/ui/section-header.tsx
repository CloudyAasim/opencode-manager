import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A heading, a line under it, and something on the right.
 *
 * This shape was drawn by hand in six places - the settings pages, the
 * terminal - and every one of them had already made its own decision about
 * the spacing: some put `mt-1` under the title and some did not, one aligned
 * its button to the middle of the two lines and the rest to the top, and
 * the description was sometimes a string and sometimes a fragment with the
 * count glued onto the end of it.
 *
 * So it is one component now, and the decisions are made once:
 *
 * - the title is `text-lg`, the same size the settings card titles use;
 * - the description is `text-sm` and sits 4px under the title;
 * - the actions line up with the **title**, not with the middle of the
 *   block - a button that floats half a title down reads as belonging to
 *   the description.
 */
interface SectionHeaderProps {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  /**
   * 1 for the heading of a page, 2 for the heading of a section.
   *
   * The default is 2, because most of these are sections inside a page that
   * already has a title somewhere else. A page that has no heading of its own
   * says so with `level={1}` rather than with an `<h1>` of its own.
   */
  level?: 1 | 2
  className?: string
}

export function SectionHeader({
  title,
  description,
  icon,
  actions,
  level = 2,
  className,
}: SectionHeaderProps) {
  const Heading = level === 1 ? 'h1' : 'h2'

  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-2', className)}>
      <div className="flex min-w-0 items-start gap-2">
        {icon ? <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span> : null}
        <div className="min-w-0">
          <Heading className="text-lg font-semibold text-foreground">{title}</Heading>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}
