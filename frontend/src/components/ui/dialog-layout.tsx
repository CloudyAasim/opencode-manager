import type { MouseEvent, PointerEvent, ReactNode } from 'react'
import { DialogHeader, DialogTitle } from '@/components/ui/dialog'

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

export function DialogLayout({
  title,
  children,
  onBodyClick,
  onBodyPointerDown,
}: DialogLayoutProps) {
  return (
    <>
      <DialogHeader className="p-4 sm:p-6 border-b flex flex-row items-center justify-between space-y-0">
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
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
