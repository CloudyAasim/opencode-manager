import type { ReactNode, RefObject } from 'react'
import { cn } from '@/lib/utils'
import { useFloatingShell } from './shell-layout'

interface ShellFrameProps {
  rootRef: RefObject<HTMLDivElement | null>
  header: ReactNode
  main: ReactNode
  status: ReactNode
  chrome?: boolean
}

/**
 * The shell is a window on a desktop.
 *
 * Plasma 6 floats three things and puts a gutter between them: the panel
 * at the top, the window in the middle, the strip at the bottom. The
 * earlier version floated only the top bar and left the page running to
 * the edges of the screen underneath it, so the two met at a seam four
 * pixels wide - a rounded pill sitting on a full-bleed bar, which read as
 * one thing with a mistake in it rather than as two things on purpose.
 *
 * Now the page is a window too: the same gutter on the same sides, the
 * same radius, and a gap above and below it. The three surfaces share one
 * set of measurements, so the eye reads a desktop with a window on it.
 *
 * A phone has no room for that, and a notch is in the way, so the narrow
 * layout is the docked one: everything runs to the edges, as it always was.
 */
export function ShellFrame({
  rootRef,
  header,
  main,
  status,
  chrome = true,
}: ShellFrameProps) {
  const floating = useFloatingShell()

  if (!chrome) {
    return (
      <div ref={rootRef} className="flex h-dvh w-full min-w-0 flex-col bg-background">
        {main}
      </div>
    )
  }

  return (
    <div ref={rootRef} className="flex h-dvh w-full min-w-0 flex-col bg-background">
      {header}
      <div
        className={cn(
          'flex min-h-0 flex-1',
          floating &&
            'mx-3 my-3 overflow-hidden rounded-xl border border-border bg-background shadow-sm',
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col">{main}</div>
      </div>
      {status}
    </div>
  )
}
