import { type LucideIcon } from 'lucide-react'
import { Button } from './button'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

type BadgeColor = 'orange' | 'blue'

const colorStyles: Record<BadgeColor, { bg: string; hover: string; text: string }> = {
  orange: {
    bg: 'bg-warning/10',
    hover: 'hover:bg-warning/20',
    text: 'text-warning',
  },
  blue: {
    bg: 'bg-info/10',
    hover: 'hover:bg-info/20',
    text: 'text-info',
  },
}

interface PendingActionBadgeProps {
  count: number
  icon: LucideIcon
  color: BadgeColor
  onClick: () => void
  label: string
  className?: string
}

export function PendingActionBadge({
  count,
  icon: Icon,
  color,
  onClick,
  label,
  className,
}: PendingActionBadgeProps) {
  const { t } = useI18n()

  if (count === 0) return null

  const styles = colorStyles[color]

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      aria-label={t('ui.pendingActionBadge.title', { count, label })}
      title={t('ui.pendingActionBadge.title', { count, label })}
      className={cn(
        'relative transition-all duration-200',
        styles.bg,
        styles.hover,
        styles.text,
        className
      )}
    >
      <Icon className="w-4 h-4" />
      <span
        className={cn(
          'absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full animate-pulse',
          color === 'orange' ? 'bg-warning' : 'bg-info'
        )}
      />
    </Button>
  )
}
