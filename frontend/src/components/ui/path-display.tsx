import { useMemo } from 'react'
import { toDisplayPathFrom } from '@/lib/display-path'

interface PathDisplayProps {
  path: string
  /** The real browse root the server returned. Without it the path is shown raw. */
  root?: string
  maxSegments?: number
  className?: string
}

export function PathDisplay({ path, root, maxSegments = 3, className = '' }: PathDisplayProps) {
  const displayPath = useMemo(() => {
    // Shortened first, so `/workspace/` counts as one segment and the
    // truncation below spends its budget on what the user is actually
    // navigating rather than on the path they already knows.
    const shortened = toDisplayPathFrom(root, path)
    if (shortened === '/') return '/'

    const segments = shortened.split('/').filter(Boolean)

    // Returned as-is when it already fits. Rebuilding it from the segments
    // would drop the trailing slash that marks a root, and the difference
    // between `/workspace/` and `/workspace` is the whole point.
    if (segments.length <= maxSegments) {
      return shortened
    }

    const visibleSegments = segments.slice(-maxSegments)
    return '/.../' + visibleSegments.join('/')
  }, [path, root, maxSegments])

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
