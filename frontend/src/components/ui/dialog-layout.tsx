import type { MouseEvent, PointerEvent, ReactNode } from 'react'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

// Six settings dialogs lay their inside out the same way: a title bar with a
// bottom border, then a body that takes the remaining height and scrolls. The
// class strings had already drifted into three orderings, which is what typing
// the same thing six times looks like.
//
// The DialogContent around it is deliberately not part of this: the widths, the
// height caps and the mobile flags differ per dialog and those are real choices.
interface DialogLayoutProps {
  title: ReactNode
  children: ReactNode
  onBodyClick?: (event: MouseEvent<HTMLDivElement>) => void
  onBodyPointerDown?: (event: PointerEvent<HTMLDivElement>) => void
}

/**
 * The title bar every dialog in this application draws.
 *
 * It was six different class strings, in six files, for the same box: a
 * title, sometimes a line under it, and sometimes a button on the right. A
 * user who has learned one dialog has to learn the next one again, and the
 * only thing that differs is the padding.
 */
export function DialogTitleBar({
  title,
  description,
  children,
  titleClassName,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  titleClassName?: string
  className?: string
}) {
  return (
    <DialogHeader
      className={cn(
        'p-4 sm:p-6 border-b flex flex-row items-center justify-between gap-3 space-y-0',
        className,
      )}
    >
      <div className="min-w-0">
        <DialogTitle className={titleClassName}>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </div>
      {children}
    </DialogHeader>
  )
}

export function DialogLayout({
  title,
  children,
  onBodyClick,
  onBodyPointerDown,
}: DialogLayoutProps) {
  return (
    <>
      <DialogTitleBar title={title} />
      <div
        className="flex-1 overflow-y-auto p-2 sm:p-4"
        onClick={onBodyClick}
        onPointerDown={onBodyPointerDown}
      >
        {children}
      </div>
    </>
  )
}
