import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { MODAL_TRANSITION_MS } from '@/lib/utils'
import { useSwipeDismiss } from '@/hooks/useMobile'
import { useCancellableTimer } from '@/hooks/use-cancellable-timer'

export interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  heightClass?: string
  className?: string
  children: React.ReactNode
  ariaLabel?: string
}

export function BottomSheet({
  isOpen,
  onClose,
  heightClass = 'h-[70dvh]',
  className,
  children,
  ariaLabel,
}: BottomSheetProps) {
  const [shouldRender, setShouldRender] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const { schedule, cancel } = useCancellableTimer()

  const { bind, swipeStyles } = useSwipeDismiss(onClose, {
    enabled: isOpen,
    threshold: 60,
  })

  useEffect(() => {
    return bind(panelRef.current)
  }, [bind])

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

  const sheet = (
    <div
      className="fixed inset-0 z-[250]"
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
        ref={panelRef}
        className={cn(
          // A sheet is a floating panel too: it clears the edge by the same
          // gutter the desktop shell uses and carries the same radius and
          // shadow. Painted to the bottom edge it read as a slab of another
          // screen, and its 16px top corner was off the radius scale the
          // whole interface is drawn on.
          //
          // One class list, on purpose - the geometry gate reads the panel out
          // of it, and a panel whose position and whose looks live in two
          // strings cannot be read.
          'fixed inset-x-3 bottom-3 z-[250] flex flex-col rounded-xl border border-border bg-surface-glass backdrop-blur-lg shadow-lg',
          heightClass,
          className,
        )}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        style={swipeStyles}
      >
        <div className="w-full flex justify-center pt-3 pb-2">
          <div className="w-9 h-1 rounded-full bg-muted-foreground/30" />
        </div>
        {children}
      </div>
    </div>
  )

  if (typeof document === 'undefined') return sheet

  return createPortal(sheet, document.body)
}

export interface BottomSheetHeaderProps {
  title?: string
  children?: React.ReactNode
}

export function BottomSheetHeader({ title, children }: BottomSheetHeaderProps) {
  return (
    <div className="flex-shrink-0 border-b border-border bg-surface-glass px-4 py-3">
      {title && (
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      )}
      {children}
    </div>
  )
}

export interface BottomSheetContentProps {
  className?: string
  children: React.ReactNode
}

export function BottomSheetContent({ className, children }: BottomSheetContentProps) {
  return (
    <div className={cn('flex-1 overflow-auto min-h-0 px-4 pt-3 pb-safe', className)}>
      {children}
    </div>
  )
}
