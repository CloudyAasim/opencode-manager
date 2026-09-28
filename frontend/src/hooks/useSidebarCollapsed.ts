import { useState, useCallback } from 'react'
import { STORAGE_KEYS } from '@/lib/storage-keys'

export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false
    }
    try {
      const stored = window.localStorage.getItem(STORAGE_KEYS.sidebarCollapsed)
      if (stored === null) return false
      const parsed = JSON.parse(stored)
      return typeof parsed === 'boolean' ? parsed : false
    } catch {
      return false
    }
  })

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, JSON.stringify(next))
        } catch {
          void 0
        }
      }
      return next
    })
  }, [])

  return [collapsed, toggle]
}
