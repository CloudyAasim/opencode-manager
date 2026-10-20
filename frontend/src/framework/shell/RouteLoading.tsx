import { useI18n } from '@/lib/i18n'

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
  const { t } = useI18n()
  return (
    <div
      role="status"
      aria-label={t('ui.panelLoading.label')}
      data-testid="route-loading"
      className="flex min-h-[60vh] items-center justify-center"
    >
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
    </div>
  )
}
