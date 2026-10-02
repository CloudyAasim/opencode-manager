import { Loader2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

// Ten panels drew this same block by hand, and the spinner quietly came out in
// three different sizes because each one was typed separately. The sizes are
// named now, so the drift is at least visible and a design pass has one place
// to collapse them from.
const SIZES = { sm: 'w-5 h-5', md: 'h-6 w-6', lg: 'h-8 w-8' } as const

interface PanelLoadingProps {
  size?: keyof typeof SIZES
  className?: string
  label?: string
}

export function PanelLoading({ size = 'lg', className, label }: PanelLoadingProps) {
  const { t } = useI18n()
  return (
    <div
      role="status"
      aria-label={label ?? t('ui.panelLoading.label')}
      className={cn('flex items-center justify-center py-12', className)}
    >
      <Loader2 className={cn('animate-spin text-muted-foreground', SIZES[size])} />
      {label && <span className="ml-2 text-sm text-muted-foreground">{label}</span>}
    </div>
  )
}
