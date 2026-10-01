import { useCallback, useState } from 'react'

interface UsePersistentBooleanStateOptions {
  storageKey: string
  defaultValue: boolean
}

export function usePersistentBooleanState({ storageKey, defaultValue }: UsePersistentBooleanStateOptions) {
  const [value, setValue] = useState<boolean>(() => {
    if (typeof window === 'undefined') return defaultValue
    const stored = window.localStorage.getItem(storageKey)
    if (stored === null) return defaultValue
    return stored === 'true'
  })

  const setStored = useCallback(
    (next: boolean) => {
      setValue(next)
      if (typeof window === 'undefined') return
      window.localStorage.setItem(storageKey, String(next))
    },
    [storageKey],
  )

  const toggle = useCallback(() => setStored(!value), [setStored, value])

  return [value, setStored, toggle] as const
}
