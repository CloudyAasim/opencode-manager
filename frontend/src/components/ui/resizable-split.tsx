import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePersistentNumberState } from '@/hooks/usePersistentNumberState'
import type { StorageKey } from '@/lib/storage-keys'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { MEDIA } from '@/framework/shell/breakpoints'
import { cn } from '@/lib/utils'

export const RESIZABLE_SPLIT_MIN_PCT = 15
export const RESIZABLE_SPLIT_MAX_PCT = 85
export const RESIZABLE_SPLIT_DEFAULT_PCT = 50
export const RESIZABLE_SPLIT_KEYBOARD_STEP = 2

interface ResizableSplitProps {
  primary: ReactNode
  secondary: ReactNode
  storageKey: StorageKey
  primaryLabel: string
  secondaryLabel: string
  className?: string
  primaryClassName?: string
  secondaryClassName?: string
}

function clampPct(value: number): number {
  if (Number.isNaN(value)) return RESIZABLE_SPLIT_DEFAULT_PCT
  return Math.min(RESIZABLE_SPLIT_MAX_PCT, Math.max(RESIZABLE_SPLIT_MIN_PCT, value))
}

export function ResizableSplit({
  primary,
  secondary,
  storageKey,
  primaryLabel,
  secondaryLabel,
  className,
  primaryClassName,
  secondaryClassName,
}: ResizableSplitProps) {
  const isWide = useMediaQuery(MEDIA.layoutUp)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [pct, setPct] = usePersistentNumberState({
    storageKey,
    defaultValue: RESIZABLE_SPLIT_DEFAULT_PCT,
    min: RESIZABLE_SPLIT_MIN_PCT,
    max: RESIZABLE_SPLIT_MAX_PCT,
  })

  const applyFromClientX = useCallback(
    (clientX: number) => {
      const node = containerRef.current
      if (!node) return
      const rect = node.getBoundingClientRect()
      if (rect.width === 0) return
      setPct(clampPct(((clientX - rect.left) / rect.width) * 100))
    },
    [setPct],
  )

  useEffect(() => {
    if (!dragging) return

    const onMove = (event: MouseEvent | TouchEvent) => {
      event.preventDefault()
      const clientX = 'touches' in event ? (event.touches[0]?.clientX ?? 0) : event.clientX
      applyFromClientX(clientX)
    }
    const onUp = () => setDragging(false)

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [dragging, applyFromClientX])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setPct((prev) => clampPct(prev - RESIZABLE_SPLIT_KEYBOARD_STEP))
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        setPct((prev) => clampPct(prev + RESIZABLE_SPLIT_KEYBOARD_STEP))
      } else if (event.key === 'Home') {
        event.preventDefault()
        setPct(RESIZABLE_SPLIT_MIN_PCT)
      } else if (event.key === 'End') {
        event.preventDefault()
        setPct(RESIZABLE_SPLIT_MAX_PCT)
      }
    },
    [setPct],
  )

  if (!isWide) {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
        <div className={cn('min-h-0 flex-1', primaryClassName)}>{primary}</div>
        <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', secondaryClassName)}>
          {secondary}
        </div>
      </div>
    )
  }

  const width = clampPct(pct)

  return (
    <div ref={containerRef} className={cn('flex min-h-0 flex-1', className)}>
      <div className={cn('min-w-0 min-h-0', primaryClassName)} style={{ width: `${width}%` }}>
        {primary}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`${primaryLabel} / ${secondaryLabel}`}
        aria-valuenow={Math.round(width)}
        aria-valuemin={RESIZABLE_SPLIT_MIN_PCT}
        aria-valuemax={RESIZABLE_SPLIT_MAX_PCT}
        tabIndex={0}
        onMouseDown={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onTouchStart={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDoubleClick={() => setPct(RESIZABLE_SPLIT_DEFAULT_PCT)}
        onKeyDown={onKeyDown}
        className={cn(
          'w-1.5 shrink-0 cursor-col-resize touch-none bg-border/40 transition-colors',
          'hover:bg-primary/40 focus-visible:bg-primary/50 focus-visible:outline-none',
          dragging && 'bg-primary/50',
        )}
        data-testid="split-handle"
        data-dragging={dragging || undefined}
      />
      <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', secondaryClassName)}>
        {secondary}
      </div>
    </div>
  )
}

export type { ResizableSplitProps }
