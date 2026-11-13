import { useRouteError, isRouteErrorResponse } from 'react-router-dom'
import { AlertTriangle, RefreshCw, LogIn, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { parseNetworkError } from '@/lib/opencode-errors'
import { FetchError } from '@/api/fetchWrapper'
import { useI18n } from '@/lib/i18n'

type Translate = ReturnType<typeof useI18n>['t']

/**
 * What the boundary knows about a failure.
 *
 * The agent used to have an error of its own - a named thing with a `data`
 * field - and the boundary could read it. That shape is gone: the layer the
 * client talks to says every failure in one envelope, and the client folds
 * that envelope into a `FetchError` before anything else sees it. So the
 * branches here are the ones that can still arrive: a route that answered
 * with a status, a request that failed, and an error nobody planned for.
 */
function getErrorDetails(error: unknown, t: Translate) {
  if (isRouteErrorResponse(error)) {
    if (error.status === 401 || error.status === 403) {
      return {
        title: t('ui.routeErrorBoundary.authenticationRequiredTitle'),
        message: t('ui.routeErrorBoundary.authenticationRequiredMessage'),
        isRetryable: false,
        statusCode: error.status,
      }
    }
    if (error.status === 404) {
      return {
        title: t('ui.routeErrorBoundary.pageNotFoundTitle'),
        message: t('ui.routeErrorBoundary.pageNotFoundMessage'),
        isRetryable: false,
        statusCode: error.status,
      }
    }
    return {
      title: error.statusText || t('ui.routeErrorBoundary.error'),
      message: error.data?.message || error.status.toString(),
      isRetryable: true,
      statusCode: error.status,
    }
  }

  // The layer said no and it was about who is asking. That is not a hiccup:
  // asking again with the same credentials will be told the same thing, so
  // the screen offers the way in rather than a retry.
  if (error instanceof FetchError && (error.statusCode === 401 || error.statusCode === 403)) {
    return {
      title: t('ui.routeErrorBoundary.authenticationRequiredTitle'),
      message: t('ui.routeErrorBoundary.authenticationRequiredMessage'),
      isRetryable: false,
      statusCode: error.statusCode,
    }
  }

  if (error instanceof Error) {
    const networkParsed = parseNetworkError(error)
    if (networkParsed.title === 'Connection Failed') {
      return {
        ...networkParsed,
        title: t('ui.routeErrorBoundary.offlineTitle'),
        message: '',
        isRetryable: false,
        variant: 'offline' as const,
      }
    }
    return networkParsed
  }

  return {
    title: t('ui.routeErrorBoundary.unexpectedTitle'),
    message: t('ui.routeErrorBoundary.unexpectedMessage'),
    isRetryable: true,
  }
}

export function RouteErrorBoundary() {
  const error = useRouteError()
  const { t } = useI18n()
  const details = getErrorDetails(error, t)
  const { title, message, isRetryable, statusCode } = details

  const isAuthError = statusCode === 401 || statusCode === 403

  if ('variant' in details && details.variant === 'offline') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background text-foreground">
        <img src="/icons/icon-192x192.png" alt="" className="h-36 w-36" />
        <div className="flex items-center gap-3 text-2xl font-semibold text-foreground">
          <WifiOff className="size-6" />
          <span>{title}</span>
        </div>
        <Button variant="outline" onClick={() => window.location.reload()}>
          <RefreshCw className="size-4" />
          {t('ui.routeErrorBoundary.reload')}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-6 text-center bg-background">
      <AlertTriangle className="size-12 text-destructive" />
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground max-w-sm">{message}</p>
      </div>
      <div className="flex gap-3">
        {isAuthError && (
          <Button variant="default" onClick={() => (window.location.href = '/login')}>
            <LogIn className="size-4 mr-2" />
            {t('ui.routeErrorBoundary.login')}
          </Button>
        )}
        {isRetryable && (
          <Button variant="outline" onClick={() => window.location.reload()}>
            <RefreshCw className="size-4" />
            {t('common.retry')}
          </Button>
        )}
      </div>
    </div>
  )
}
