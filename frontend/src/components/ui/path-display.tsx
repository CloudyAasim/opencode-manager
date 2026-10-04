import { useMemo } from 'react'
import { toDisplayPath } from '@/lib/display-path'

interface PathDisplayProps {
  path: string
  maxSegments?: number
  className?: string
}

export function PathDisplay({ path, maxSegments = 3, className = '' }: PathDisplayProps) {
  const displayPath = useMemo(() => {
    // Shortened first, so `/workspace` counts as one segment and the
    // truncation below spends its budget on what the user is actually
    // navigating rather than on the path they already knows.
    const shortened = toDisplayPath(path)
    if (shortened === '/') return '/'

    const segments = shortened.split('/').filter(Boolean)

    if (segments.length <= maxSegments) {
      return '/' + segments.join('/')
    }

    const visibleSegments = segments.slice(-maxSegments)
    return '/.../' + visibleSegments.join('/')
  }, [path, maxSegments])

  return (
    <span
      className={`text-sm text-muted-foreground bg-muted px-2 py-1 rounded font-mono truncate ${className}`}
      // The shortened path, not the real one. The point of the shortening is
      // that the account name and the on-disk layout stop being part of the
      // interface, and a tooltip is part of the interface.
      title={displayPath}
    >
      {displayPath}
    </span>
  )
}
