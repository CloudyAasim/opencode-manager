import { useVirtualizer } from '@tanstack/react-virtual'
import type { RefObject } from 'react'

interface VirtualMessageListProps<T> {
  items: T[]
  scrollRef: RefObject<HTMLElement | null>
  enabled: boolean
  estimateSize: () => number
  getKey: (item: T, index: number) => string
  overscan?: number
  children: (item: T, index: number) => React.ReactNode
}

export function VirtualMessageList<T>({
  items,
  scrollRef,
  enabled,
  estimateSize,
  getKey,
  overscan = 8,
  children,
}: VirtualMessageListProps<T>) {
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize(),
    getItemKey: (index) => getKey(items[index] as T, index),
    overscan,
    enabled,
  })

  if (!enabled) {
    return <>{items.map((item, index) => children(item, index))}</>
  }

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        position: 'relative',
        width: '100%',
      }}
    >
      {virtualItems.map((virtualItem) => {
        const item = items[virtualItem.index] as T
        return (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {children(item, virtualItem.index)}
          </div>
        )
      })}
    </div>
  )
}
