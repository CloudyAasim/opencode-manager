import type { ReactNode, RefObject } from 'react'
import { useDesktop } from '@/hooks/useDesktop'

interface ShellFrameProps {
  rootRef: RefObject<HTMLDivElement | null>
  rail: ReactNode
  main: ReactNode
  bottom: ReactNode
  status: ReactNode
}

export function ShellFrame({ rootRef, rail, main, bottom, status }: ShellFrameProps) {
  const isDesktop = useDesktop()

  return (
    <div ref={rootRef} className="flex h-dvh w-full min-w-0 flex-col bg-background">
      <div className="flex min-h-0 flex-1">
        {isDesktop && rail}
        <div className="flex min-w-0 flex-1 flex-col">{main}</div>
      </div>
      {!isDesktop && bottom}
      {status}
    </div>
  )
}
