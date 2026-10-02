import type { ReactNode, RefObject } from 'react'
import { useDesktop } from '@/hooks/useDesktop'

interface ShellFrameProps {
  rootRef: RefObject<HTMLDivElement | null>
  header: ReactNode
  rail: ReactNode
  inspector: ReactNode
  main: ReactNode
  status: ReactNode
  chrome?: boolean
}

export function ShellFrame({
  rootRef,
  header,
  rail,
  inspector,
  main,
  status,
  chrome = true,
}: ShellFrameProps) {
  const isDesktop = useDesktop()

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
        {isDesktop && rail}
        <div className="flex min-w-0 flex-1 flex-col">{main}</div>
        {inspector}
      </div>
      {status}
    </div>
  )
}
