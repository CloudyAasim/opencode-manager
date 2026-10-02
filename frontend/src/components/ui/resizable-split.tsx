import { useCallback, useRef, type ReactNode } from 'react'
import { usePersistentNumberState } from '@/hooks/usePersistentNumberState'
import type { StorageKey } from '@/lib/storage-keys'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { MEDIA } from '@/framework/shell/breakpoints'
import { percentOfContainer, useDragResize } from '@/framework/shell/useDragResize'
import { cn } from '@/lib/utils'

export const RESIZABLE_SPLIT_MIN_PCT = 15
export const RESIZABLE_SPLIT_MAX_PCT = 85
export const RESIZABLE_SPLIT_DEFAULT_PCT = 50
export const RESIZABLE_SPLIT_KEYBOARD_STEP = 2

interface ResizableSplitProps {
  primary: ReactNode
  secondary?: ReactNode
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
  const [pct, setPct] = usePersistentNumberState({
    storageKey,
    defaultValue: RESIZABLE_SPLIT_DEFAULT_PCT,
    min: RESIZABLE_SPLIT_MIN_PCT,
    max: RESIZABLE_SPLIT_MAX_PCT,
  })

  const startResize = useDragResize({
    containerRef,
    getValue: () => pct,
    setValue: (next) => setPct(clampPct(next)),
    toValue: percentOfContainer,
  })

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
        {secondary ? (
          <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', secondaryClassName)}>
            {secondary}
          </div>
        ) : null}
      </div>
    )
  }

  const width = clampPct(pct)

  return (
    <div ref={containerRef} className={cn('flex min-h-0 flex-1', className)}>
      <div
        className={cn('min-w-0 min-h-0', primaryClassName)}
        style={{ width: secondary ? `${width}%` : '100%' }}
      >
        {primary}
      </div>
      {secondary ? (
        <>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`${primaryLabel} / ${secondaryLabel}`}
          aria-valuenow={Math.round(width)}
          aria-valuemin={RESIZABLE_SPLIT_MIN_PCT}
          aria-valuemax={RESIZABLE_SPLIT_MAX_PCT}
          tabIndex={0}
          onMouseDown={startResize.onMouseDown}
          onTouchStart={startResize.onTouchStart}
          onDoubleClick={() => setPct(RESIZABLE_SPLIT_DEFAULT_PCT)}
          onKeyDown={onKeyDown}
          className={cn(
            'w-1.5 shrink-0 cursor-col-resize touch-none bg-border/40 transition-colors',
            'hover:bg-primary/40 focus-visible:bg-primary/50 focus-visible:outline-none',
            startResize.dragging && 'bg-primary/50',
          )}
          data-testid="split-handle"
          data-dragging={startResize.dragging || undefined}
        />
        <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', secondaryClassName)}>
          {secondary}
        </div>
          </>
      ) : null}
    </div>
  )
}

export type { ResizableSplitProps }
