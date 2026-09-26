import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

type Translate = ReturnType<typeof useI18n>['t']

interface InnerProps extends Props {
  t: Translate
}

class ErrorBoundaryInner extends Component<InnerProps, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-6 text-center bg-background">
          <AlertTriangle className="w-12 h-12 text-destructive" />
          <div className="space-y-2">
            <h1 className="text-xl font-semibold text-foreground">{this.props.t('ui.errorBoundary.title')}</h1>
            <p className="text-sm text-muted-foreground max-w-sm">
              {this.state.error.message}
            </p>
          </div>
          <Button variant="outline" onClick={this.reset} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            {this.props.t('ui.errorBoundary.tryAgain')}
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}

export function ErrorBoundary(props: Props) {
  const { t } = useI18n()
  return <ErrorBoundaryInner {...props} t={t} />
}
