import { useCallback, useEffect, useState } from 'react'

interface UsePersistentNumberStateOptions {
  storageKey: string
  defaultValue: number
  min?: number
  max?: number
}

const clamp = (value: number, min?: number, max?: number): number => {
  if (typeof min === 'number' && value < min) return min
  if (typeof max === 'number' && value > max) return max
  return value
}

const readPersisted = (storageKey: string, fallback: number, min?: number, max?: number): number => {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (raw === null) return fallback
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return fallback
    return clamp(parsed, min, max)
  } catch {
    return fallback
  }
}

export function usePersistentNumberState({
  storageKey,
  defaultValue,
  min,
  max,
}: UsePersistentNumberStateOptions): [number, (next: number | ((prev: number) => number)) => void] {
  const [value, setValue] = useState<number>(() => readPersisted(storageKey, defaultValue, min, max))

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(value))
    } catch {
      void 0
    }
  }, [storageKey, value])

  const update = useCallback(
    (next: number | ((prev: number) => number)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: number) => number)(prev) : next
        return clamp(resolved, min, max)
      })
    },
    [min, max],
  )

  return [value, update]
}