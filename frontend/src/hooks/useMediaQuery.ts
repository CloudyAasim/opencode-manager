import { useEffect, useState } from 'react'
import { MEDIA } from '@/framework/shell/breakpoints'

export const DESKTOP_MEDIA_QUERY = MEDIA.compactUp

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false
    }
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return
    }
    const mediaQuery = window.matchMedia(query)
    setMatches(mediaQuery.matches)
    const update = () => setMatches(mediaQuery.matches)
    mediaQuery.addEventListener('change', update)
    return () => mediaQuery.removeEventListener('change', update)
  }, [query])

  return matches
}
