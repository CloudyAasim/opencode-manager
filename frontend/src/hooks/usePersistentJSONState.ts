import { useCallback, useEffect, useState } from 'react'

interface UsePersistentJSONStateOptions<T> {
  storageKey: string
  defaultValue: T
  validate?: (value: unknown) => value is T
}

export function usePersistentJSONState<T>({
  storageKey,
  defaultValue,
  validate,
}: UsePersistentJSONStateOptions<T>): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return defaultValue
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw === null) return defaultValue
      const parsed: unknown = JSON.parse(raw)
      if (validate && !validate(parsed)) return defaultValue
      return parsed as T
    } catch {
      return defaultValue
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value))
    } catch {
      void 0
    }
  }, [storageKey, value])

  const update = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => (typeof next === 'function' ? (next as (p: T) => T)(prev) : next))
  }, [])

  return [value, update]
}
