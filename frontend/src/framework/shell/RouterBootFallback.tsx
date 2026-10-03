/**
 * React Router asks for this while the first match settles, and logs a warning
 * when it is missing. It is also the only thing on screen during that gap, so
 * it gets a plain centred mark rather than nothing at all.
 */
export function RouterBootFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <div
        data-testid="router-boot-fallback"
        className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
      />
    </div>
  )
}
