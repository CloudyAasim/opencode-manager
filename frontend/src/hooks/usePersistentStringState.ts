import { useCallback, useState } from 'react'

interface UsePersistentStringStateOptions {
  storageKey: string
  defaultValue: string
}

export function usePersistentStringState({ storageKey, defaultValue }: UsePersistentStringStateOptions) {
  const [value, setValueState] = useState<string>(() => {
    if (typeof window === 'undefined') return defaultValue
    return window.localStorage.getItem(storageKey) ?? defaultValue
  })

  const setValue = useCallback(
    (next: string) => {
      setValueState(next)
      if (typeof window === 'undefined') return
      window.localStorage.setItem(storageKey, next)
    },
    [storageKey],
  )

  return [value, setValue] as const
}
