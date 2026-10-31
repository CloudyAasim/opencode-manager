import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { MODAL_TRANSITION_MS } from '@/lib/utils'
import { X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { useCancellableTimer } from '@/hooks/use-cancellable-timer'

/**
 * 抽屉有多宽。
 *
 * 应用里**只有一个宽度**被真正用过 ✓，所以刻度上就**只有这一档** ✓——
 * 多摆一档没人用的 ✓，就是**摆在那儿** ✓。
 * 以前那是一个 `widthClass` ✓ 的字符串 ✓——**每个调用点自己写宽度** ✓，
 * 写的是**随手写的数** ✓（`min(92vw,420px)` ✓）。
 */
const SIDE_DRAWER_WIDTHS = {
  lg: 'w-[min(92vw,420px)]',
} as const

type SideDrawerWidth = keyof typeof SIDE_DRAWER_WIDTHS

export interface SideDrawerProps {
  isOpen: boolean
  onClose: () => void
  /** 抽屉有多宽 ✓——**说哪一档** ✓，不许自己写 ✓。 */
  width?: SideDrawerWidth
  className?: string
  children: React.ReactNode
  ariaLabel?: string
}

/**
 * The drawer that comes up on a phone.
 *
 * There is one of them and it is on the right, so there is no `side` to
 * choose: the prop existed for a second drawer that was never built, and it
 * cost the class list a split that the geometry gate could not read - a panel
 * whose position and whose looks live in two strings cannot be checked
 * against either.
 */
export function SideDrawer({
  isOpen,
  onClose,
  width = 'lg',
  className,
  children,
  ariaLabel,
}: SideDrawerProps) {
  const [shouldRender, setShouldRender] = useState(false)
  const { schedule, cancel } = useCancellableTimer()

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
    } else {
      schedule('hide', () => setShouldRender(false), MODAL_TRANSITION_MS)
      return () => cancel('hide')
    }
  }, [isOpen, schedule, cancel])

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])

  if (!isOpen && !shouldRender) return null

  return (
    <div
      className="fixed inset-0 z-50"
      style={{
        opacity: isOpen ? 1 : 0,
        pointerEvents: isOpen ? 'auto' : 'none',
        transition: `opacity ${MODAL_TRANSITION_MS}ms ease-out`,
      }}
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={cn(
          // The drawer is the phone's face of the same floating panel the
          // desktop shell floats. It used to be a slab painted to the edge of
          // the screen - a square corner on the right, a hard rule under the
          // header - which is the one thing the rest of the interface stopped
          // being. Now it clears the edge by the same gutter the shell uses,
          // and it carries the same radius, border and shadow.
          //
          // The top inset is the safe area plus that gutter: a phone with a
          // punch hole would otherwise have the notch cut into the panel's
          // top corner, and a phone without one would have the panel flush
          // against the top.
          //
          // One class list, on purpose. The geometry gate reads the panel out
          // of it, and a panel whose position and whose looks live in two
          // strings cannot be read - the gate would see the corner and not
          // the gutter, and say nothing.
          'fixed bottom-3 right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-50 flex flex-col rounded-xl border border-border bg-surface-glass backdrop-blur-lg shadow-lg',
          SIDE_DRAWER_WIDTHS[width],
          className,
        )}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        {children}
      </div>
    </div>
  )
}

export interface SideDrawerHeaderProps {
  title: string
  onClose: () => void
  meta?: React.ReactNode
}

export function SideDrawerHeader({ title, onClose, meta }: SideDrawerHeaderProps) {
  const { t } = useI18n()
  return (
    <div className="flex-shrink-0 border-b border-border bg-surface-glass px-4 py-2 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold text-foreground leading-none">{title}</h2>
        {meta ? <div className="mt-1 min-w-0">{meta}</div> : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onClose}
        className="shrink-0 text-muted-foreground"
        aria-label={t('ui.sideDrawer.close')}
      >
        <X className="size-5" />
      </Button>
    </div>
  )
}

export interface SideDrawerContentProps {
  className?: string
  children: React.ReactNode
}

export function SideDrawerContent({ className, children }: SideDrawerContentProps) {
  return (
    <div className={cn('flex-1 overflow-auto min-h-0 px-4 py-3', className)}>
      {children}
    </div>
  )
}
