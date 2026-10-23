import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A heading, a line under it, and something on the right.
 *
 * This shape was drawn by hand in five places - the settings pages - and
 * every one of them had already made its own decision about the spacing:
 * some put `mt-1` under the title and some did not, one aligned its button
 * to the middle of the two lines and the rest to the top, and the description
 * was sometimes a string and sometimes a fragment with the count glued onto
 * the end of it.
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
  className?: string
}

/**
 * A heading *inside* a page.
 *
 * It is always a section, and it is always an `h2`: the heading of the page
 * itself belongs to the shared `Header`, which is the one place a page
 * says what it is. There used to be a way to ask this component for the
 * other level, and the terminal page used it - a page title wearing a
 * section's clothes, which is the same heading at two sizes depending on
 * which component happened to draw it.
 */
export function SectionHeader({
  title,
  description,
  icon,
  actions,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-2', className)}>
      <div className="flex min-w-0 items-start gap-2">
        {icon ? <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span> : null}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}
