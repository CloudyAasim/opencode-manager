import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Folder, FileText, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PanelLoading } from '@/components/ui/panel-loading'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDestructiveDialog } from '@/components/ui/confirm-destructive-dialog'
import { getAssistantWorkspaceContents } from '@/api/repos'
import { deleteFileOrFolder } from '@/api/files'
import { showErrorToast } from '@/lib/error-toast'
import { useI18n } from '@/lib/i18n'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import type { AssistantWorkspaceEntry } from '@opencode-manager/shared/types'

/**
 * The assistant's directory is a sibling of the projects directory rather than
 * a child of the file browser's root, so the app had no way to show what was in
 * it or let the user remove it. `DELETE /api/files` already accepted these paths
 * - the settings directory is in the caller's allowed roots - so what was
 * missing was visibility, not permission.
 *
 * `sizeBytes` comes from a bounded recursive walk that reports `truncated` when
 * it hits its budget, because the thing being measured is usually "did something
 * get cloned in here", which can be a repository with a populated node_modules.
 */

const QUERY_KEY = ['assistant-workspace-contents']

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function AssistantWorkspaceSettings() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [pendingDelete, setPendingDelete] = useState<AssistantWorkspaceEntry | null>(null)

  const contentsQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => getAssistantWorkspaceContents(ASSISTANT_REPO_ID),
  })

  const deleteMutation = useMutation({
    mutationFn: (entry: AssistantWorkspaceEntry) => deleteFileOrFolder(entry.path),
    onSuccess: (_result, entry) => {
      setPendingDelete(null)
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      // Managed files are rewritten on the next assistant initialisation, so
      // saying so is the difference between "I broke it" and "I know what that
      // was" - a user's own edits to assistant.md are not recoverable.
      toast.success(
        entry.isManaged
          ? t('settings.assistantWorkspace.deletedManaged', { name: entry.name })
          : t('settings.assistantWorkspace.deleted', { name: entry.name }),
      )
    },
    onError: (error) => {
      showErrorToast(error, t('settings.assistantWorkspace.deleteFailed'))
    },
  })

  const entries = contentsQuery.data?.entries ?? []
  const totalSizeBytes = contentsQuery.data?.totalSizeBytes ?? 0
  const truncated = contentsQuery.data?.truncated ?? false

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">{t('settings.assistantWorkspace.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('settings.assistantWorkspace.description')}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => contentsQuery.refetch()}
          disabled={contentsQuery.isFetching}
        >
          {contentsQuery.isFetching ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {t('settings.assistantWorkspace.refresh')}
        </Button>
      </div>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>{t('settings.assistantWorkspace.projectsHint')}</AlertDescription>
      </Alert>

      <Card className="border-0 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base sm:text-lg">
            {t('settings.assistantWorkspace.contents')}
            <Badge variant="secondary">
              {formatBytes(totalSizeBytes)}{truncated ? '+' : ''}
            </Badge>
          </CardTitle>
          <CardDescription className="break-all text-xs sm:text-sm">
            {contentsQuery.data?.directory ?? '—'}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {contentsQuery.isLoading ? (
            <PanelLoading className="py-8" size="sm" />
          ) : contentsQuery.isError ? (
            <p className="py-6 text-center text-sm text-destructive">
              {t('settings.assistantWorkspace.loadFailed')}
            </p>
          ) : entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('settings.assistantWorkspace.empty')}
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {entries.map((entry) => (
                <li key={entry.path} className="flex items-center gap-3 py-2">
                  {entry.isDirectory ? (
                    <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm" title={entry.name}>
                    {entry.name}
                  </span>
                  {entry.isManaged && (
                    <Badge variant="outline" className="shrink-0">
                      {t('settings.assistantWorkspace.managed')}
                    </Badge>
                  )}
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {formatBytes(entry.sizeBytes)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0"
                    aria-label={t('settings.assistantWorkspace.deleteFor', { name: entry.name })}
                    onClick={() => setPendingDelete(entry)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {truncated && (
        <p className="text-xs text-muted-foreground">{t('settings.assistantWorkspace.truncated')}</p>
      )}

      <ConfirmDestructiveDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete)
        }}
        onCancel={() => setPendingDelete(null)}
        title={t('settings.assistantWorkspace.deleteTitle')}
        description={
          <>
            <span className="font-mono break-all">{pendingDelete?.name}</span>
            <span className="mt-2 block">
              {pendingDelete?.isManaged
                ? t('settings.assistantWorkspace.deleteManagedDescription')
                : t('settings.assistantWorkspace.deleteDescription')}
            </span>
          </>
        }
        confirmLabel={t('settings.assistantWorkspace.deleteConfirm')}
        cancelLabel={t('common.cancel')}
        isPending={deleteMutation.isPending}
      />
    </div>
  )
}
