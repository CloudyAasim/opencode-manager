import { PanelLoading } from '@/components/ui/panel-loading'

/**
 * What is on screen while a page's code is still travelling.
 *
 * The page switch used to leave the previous page on screen until the new
 * page's chunk had arrived, so the wait looked like the app had ignored
 * the click. The route is now handed to React as soon as it is chosen and
 * this stands in for the content that has not arrived yet.
 *
 * The shell around it - the top bar, the navigation, the status bar -
 * stays put, so the switch is visible even while the page body is still
 * on its way.
 */
export function RouteLoading() {
  return (
    <PanelLoading className="min-h-[60vh]" size="md" data-testid="route-loading" />
  )
}
