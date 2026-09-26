import { Badge } from '@/components/ui/badge'
import { CheckCircle2, AlertCircle, Code, Loader2 } from 'lucide-react'
import type { LspStatus } from '@/api/opencode'
import { useI18n } from '@/lib/i18n'

interface RepoLspServerListProps {
  isLoading: boolean
  data: LspStatus[] | undefined
}

export function RepoLspServerList({ isLoading, data }: RepoLspServerListProps) {
  const { t } = useI18n()
  const formatServerName = (name: string): string => {
    const formatted = name.replace(/[-_]/g, ' ')
    return formatted.charAt(0).toUpperCase() + formatted.slice(1)
  }

  const getStatusBadge = (status: 'connected' | 'error') => {
    if (status === 'connected') {
      return (
        <Badge variant="default" className="text-xs bg-green-600">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          {t('repo.lsp.active')}
        </Badge>
      )
    }

    return (
      <Badge variant="destructive" className="text-xs">
        <AlertCircle className="h-3 w-3 mr-1" />
        {t('repo.lsp.error')}
      </Badge>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" />
        <span className="ml-2 text-sm text-muted-foreground">{t('repo.loading')}</span>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <Code className="w-10 h-10 mx-auto mb-3 opacity-50" />
        <p className="text-sm">{t('repo.lsp.empty')}</p>
        <p className="text-xs mt-1">{t('repo.lsp.emptyHint')}</p>
      </div>
    )
  }

  return (
    <div className="px-4 sm:px-6 py-3 sm:py-4 flex-1 overflow-y-auto min-h-0">
      <div className="space-y-3">
        {data.map((server) => (
          <div
            key={server.id}
            className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-card"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-sm font-medium truncate">
                  {formatServerName(server.name)}
                </p>
                {getStatusBadge(server.status)}
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {server.root}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
