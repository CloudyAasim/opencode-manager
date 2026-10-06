import { useState } from 'react'
import { PanelLoading } from '@/components/ui/panel-loading'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle, History, Loader2, RefreshCw, Trash2, FileCog } from 'lucide-react'
import { auditApi, type OpenCodeConfigAuditEntry } from '@/api/audit'
import { useI18n } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDestructiveDialog } from '@/components/ui/confirm-destructive-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type StatusFilter = 'all' | 'active' | 'ended'

const PRUNE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString()
}

function formatDuration(startedAt: number, endedAt: number | null): string {
  if (!endedAt) return '—'
  const seconds = Math.max(0, Math.round((endedAt - startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * What a config write touched.
 *
 * The provider ids are pulled out of `details` and shown next to the key
 * instead of inside it, because "provider" on its own does not tell an admin
 * whether somebody added an endpoint of their own or rewrote the models of one
 * everybody is already using. When there are no ids either way - a write that
 * only edited a provider that was already declared - the key is still shown,
 * because a blank cell reads as "nothing happened" and something did.
 */
function ChangedKeys({ entry }: { entry: OpenCodeConfigAuditEntry }) {
  const { t } = useI18n()
  const provider = entry.details?.provider as { added?: unknown; removed?: unknown } | undefined
  const added = Array.isArray(provider?.added) ? (provider?.added as string[]) : []
  const removed = Array.isArray(provider?.removed) ? (provider?.removed as string[]) : []
  const touchedProviderOnly = entry.changedKeys.length === 1
    && entry.changedKeys[0] === 'provider'
    && added.length === 0
    && removed.length === 0
  const otherKeys = touchedProviderOnly
    ? []
    : entry.changedKeys.filter((key) => key !== 'provider')

  return (
    <span className="flex flex-wrap items-center gap-1">
      {otherKeys.map((key) => (
        <Badge key={key} variant="outline" className="font-mono text-[10px]">{key}</Badge>
      ))}
      {added.map((id) => (
        <Badge key={`+${id}`} className="bg-green-600 hover:bg-green-700 font-mono text-[10px]">
          {t('settings.audit.configProviderAdded', { ids: id })}
        </Badge>
      ))}
      {removed.map((id) => (
        <Badge key={`-${id}`} variant="destructive" className="font-mono text-[10px]">
          {t('settings.audit.configProviderRemoved', { ids: id })}
        </Badge>
      ))}
      {touchedProviderOnly && (
        <Badge variant="outline" className="font-mono text-[10px]">provider</Badge>
      )}
      {entry.changedKeys.length === 0 && (
        <span className="text-muted-foreground">{t('settings.audit.configNoChanges')}</span>
      )}
    </span>
  )
}

export function AuditSettings() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [emailInput, setEmailInput] = useState('')
  const [appliedEmail, setAppliedEmail] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [pruneOpen, setPruneOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const active = status === 'all' ? undefined : status === 'active'

  const auditQuery = useQuery({
    queryKey: ['terminal-audit', appliedEmail, status],
    queryFn: () => auditApi.listTerminal({ email: appliedEmail || undefined, active, limit: 100 }),
  })

  const configQuery = useQuery({
    queryKey: ['config-audit', appliedEmail],
    queryFn: () => auditApi.listConfig({ email: appliedEmail || undefined, limit: 100 }),
  })

  const pruneMutation = useMutation({
    mutationFn: () => auditApi.prune(Date.now() - PRUNE_WINDOW_MS),
    onSuccess: (result) => {
      setError(null)
      setNotice(t('settings.audit.pruned', { count: result.deleted }))
      setPruneOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['terminal-audit'] })
      void queryClient.invalidateQueries({ queryKey: ['config-audit'] })
    },
    onError: (err) => {
      setNotice(null)
      setError(err instanceof Error ? err.message : t('settings.audit.loadFailed'))
      setPruneOpen(false)
    },
  })

  const entries = auditQuery.data?.entries ?? []
  const total = auditQuery.data?.total ?? 0
  const configEntries = configQuery.data?.entries ?? []
  const configTotal = configQuery.data?.total ?? 0

  const applyEmailFilter = () => setAppliedEmail(emailInput.trim())

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('settings.audit.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('settings.audit.description')} · {t('settings.audit.total', { count: total })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => auditQuery.refetch()} disabled={auditQuery.isFetching}>
            {auditQuery.isFetching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {t('settings.audit.refresh')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPruneOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4 text-destructive" />
            {t('settings.audit.prune')}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {notice && (
        <Alert className="border-green-500 text-green-700 dark:text-green-400">
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="audit-email" className="text-xs sm:text-sm">{t('settings.audit.filterEmail')}</Label>
          <Input
            id="audit-email"
            value={emailInput}
            onChange={(event) => setEmailInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') applyEmailFilter()
            }}
            placeholder={t('settings.audit.filterEmailPlaceholder')}
            className="h-9 sm:h-10 md:text-sm"
          />
        </div>
        <div className="space-y-1.5 sm:w-40">
          <Label htmlFor="audit-status" className="text-xs sm:text-sm">{t('settings.audit.status')}</Label>
          <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
            <SelectTrigger id="audit-status" className="h-9 sm:h-10 md:text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('settings.audit.statusAll')}</SelectItem>
              <SelectItem value="active">{t('settings.audit.statusActive')}</SelectItem>
              <SelectItem value="ended">{t('settings.audit.statusEnded')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={applyEmailFilter} className="h-9 sm:h-10">{t('common.confirm')}</Button>
      </div>

      <Card className="border-0 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <History className="h-4 w-4 sm:h-5 sm:w-5" />
            {t('settings.audit.title')}
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">{t('settings.audit.description')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {auditQuery.isLoading ? (
            <PanelLoading className="py-8" size="sm" />
          ) : auditQuery.isError ? (
            <p className="py-6 text-center text-sm text-destructive">{t('settings.audit.loadFailed')}</p>
          ) : entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('settings.audit.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">{t('settings.audit.startedAt')}</th>
                    <th className="px-3 py-2 font-medium">{t('settings.audit.user')}</th>
                    <th className="px-3 py-2 font-medium">{t('settings.audit.cwd')}</th>
                    <th className="px-3 py-2 font-medium">{t('settings.audit.duration')}</th>
                    <th className="px-3 py-2 font-medium">{t('settings.audit.status')}</th>
                    <th className="px-3 py-2 font-medium">{t('settings.audit.ipAddress')}</th>
                    <th className="px-3 py-2 font-medium">{t('settings.audit.size')}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-border/60 last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 text-xs">{formatTimestamp(entry.startedAt)}</td>
                      <td className="px-3 py-2 text-xs">{entry.userEmail ?? entry.userId}</td>
                      <td className="max-w-[220px] truncate px-3 py-2 font-mono text-xs" title={entry.cwd ?? ''}>
                        {entry.cwd ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">{formatDuration(entry.startedAt, entry.endedAt)}</td>
                      <td className="px-3 py-2 text-xs">
                        {entry.active ? (
                          <Badge variant="secondary">{t('settings.audit.active')}</Badge>
                        ) : (
                          <span className="text-muted-foreground">
                            {t('settings.audit.exitCode')}: {entry.exitCode ?? '-'}
                            {entry.closeReason ? ` · ${entry.closeReason}` : ''}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{entry.ipAddress ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">{formatBytes(entry.totalBytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <FileCog className="h-4 w-4 sm:h-5 sm:w-5" />
            {t('settings.audit.configTitle')}
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            {t('settings.audit.configDescription')} · {t('settings.audit.total', { count: configTotal })}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {configQuery.isLoading ? (
            <PanelLoading className="py-8" size="sm" />
          ) : configQuery.isError ? (
            <p className="py-6 text-center text-sm text-destructive">{t('settings.audit.loadFailed')}</p>
          ) : configEntries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('settings.audit.configEmpty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">{t('settings.audit.when')}</th>
                    <th className="px-3 py-2 font-medium">{t('settings.audit.user')}</th>
                    <th className="px-3 py-2 font-medium">{t('settings.audit.configScope')}</th>
                    <th className="px-3 py-2 font-medium">{t('settings.audit.configChangedKeys')}</th>
                    <th className="px-3 py-2 font-medium">{t('settings.audit.configSource')}</th>
                    <th className="px-3 py-2 font-medium">{t('settings.audit.ipAddress')}</th>
                  </tr>
                </thead>
                <tbody>
                  {configEntries.map((entry) => (
                    <tr key={entry.id} className="border-b border-border/60 last:border-b-0">
                      <td className="whitespace-nowrap px-3 py-2 text-xs">{formatTimestamp(entry.createdAt)}</td>
                      <td className="px-3 py-2 text-xs">
                        {entry.userEmail ?? entry.userId ?? t('settings.audit.configUnattributed')}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">
                        {entry.scope === 'user'
                          ? t('settings.audit.configScopeUser', { name: entry.subject ?? '' })
                          : t('settings.audit.configScopeGlobal')}
                        {entry.restartPending && (
                          <Badge variant="secondary" className="ml-1">{t('settings.audit.configRestart')}</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <ChangedKeys entry={entry} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{entry.source ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{entry.ipAddress ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDestructiveDialog
        open={pruneOpen}
        onOpenChange={(open) => !open && setPruneOpen(false)}
        onConfirm={() => pruneMutation.mutate()}
        onCancel={() => setPruneOpen(false)}
        title={t('settings.audit.pruneTitle')}
        description={t('settings.audit.pruneDescription')}
        confirmLabel={t('settings.audit.pruneConfirm')}
        cancelLabel={t('common.cancel')}
        isPending={pruneMutation.isPending}
      />
    </div>
  )
}