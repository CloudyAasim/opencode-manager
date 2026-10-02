import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// "Nothing here" and "that did not work" were both drawn out by hand in every
// tab of the source-control feature - same centred block, same dimmed icon, same
// title, same smaller detail line. Seven copies, and SettingsList had already
// grown its own version of the same thing.
interface PanelMessageProps {
  icon: ReactNode
  title: ReactNode
  detail?: ReactNode
  action?: ReactNode
  className?: string
}

export function PanelMessage({ icon, title, detail, action, className }: PanelMessageProps) {
  return (
    <div className={cn('text-center py-12 text-muted-foreground', className)}>
      <div className="mx-auto mb-2 w-8 h-8 opacity-50 [&>svg]:w-full [&>svg]:h-full">{icon}</div>
      <p className="text-sm">{title}</p>
      {detail && <p className="text-xs mt-1">{detail}</p>}
      {action}
    </div>
  )
}
