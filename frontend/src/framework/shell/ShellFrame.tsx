import type { ReactNode, RefObject } from 'react'

interface ShellFrameProps {
  rootRef: RefObject<HTMLDivElement | null>
  header: ReactNode
  main: ReactNode
  status: ReactNode
  chrome?: boolean
}

export function ShellFrame({
  rootRef,
  header,
  main,
  status,
  chrome = true,
}: ShellFrameProps) {
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
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">{main}</div>
      </div>
      {status}
    </div>
  )
}
