import { PanelLoading } from '@/components/ui/panel-loading'

/**
 * React Router asks for this while the first match settles, and logs a warning
 * when it is missing. It is also the only thing on screen during that gap, so
 * it gets a plain centred mark rather than nothing at all.
 */
export function RouterBootFallback() {
  return (
    <PanelLoading
      className="min-h-dvh bg-background"
      size="md"
      data-testid="router-boot-fallback"
    />
  )
}
