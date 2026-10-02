import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

// One implementation of "drag a separator to change a number".
//
// Four places used to hand-roll the same mousemove/mouseup dance: the
// resizable split, the session rail, and the two separators on the session
// page. Three of them forgot to lock text selection, so a drag smeared a
// text selection across the page, and two of them were mouse-only while the
// rest handled touch. The arithmetic is the part that genuinely differs, so
// that is the only thing a caller supplies.

export interface DragStart {
  clientX: number
  value: number
  rect: DOMRect | null
}

export type DragValue = (clientX: number, start: DragStart) => number

interface DragResizeOptions<T extends Element> {
  getValue: () => number
  setValue: (next: number) => void
  toValue: DragValue
  containerRef?: RefObject<T | null>
}

export function useDragResize<T extends Element = HTMLElement>({
  getValue,
  setValue,
  toValue,
  containerRef,
}: DragResizeOptions<T>) {
  const optionsRef = useRef({ getValue, setValue, toValue, containerRef })
  optionsRef.current = { getValue, setValue, toValue, containerRef }
  const releaseRef = useRef<(() => void) | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => () => releaseRef.current?.(), [])

  const start = useCallback((clientX: number) => {
    releaseRef.current?.()
    setDragging(true)

    const { getValue: read, setValue: write, toValue: project, containerRef: container } = optionsRef.current
    const origin: DragStart = {
      clientX,
      value: read(),
      rect: container?.current?.getBoundingClientRect() ?? null,
    }

    const onMove = (event: MouseEvent | TouchEvent) => {
      event.preventDefault()
      const x = 'touches' in event ? (event.touches[0]?.clientX ?? origin.clientX) : event.clientX
      write(project(x, origin))
    }
    const onUp = () => {
      releaseRef.current?.()
      setDragging(false)
    }

    releaseRef.current = () => {
      releaseRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      setDragging(false)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }, [])

  const onMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      start(event.clientX)
    },
    [start],
  )

  const onTouchStart = useCallback(
    (event: React.TouchEvent) => {
      event.preventDefault()
      start(event.touches[0]?.clientX ?? 0)
    },
    [start],
  )

  return { onMouseDown, onTouchStart, dragging }
}

// The three shapes in use: a share of the container, and pixel deltas that
// grow or shrink with the drag.

export function percentOfContainer(clientX: number, start: DragStart): number {
  if (!start.rect || start.rect.width === 0) return start.value
  return ((clientX - start.rect.left) / start.rect.width) * 100
}

export function pixelDelta(clientX: number, start: DragStart): number {
  return start.value + (clientX - start.clientX)
}

export function pixelDeltaInverted(clientX: number, start: DragStart): number {
  return start.value - (clientX - start.clientX)
}
