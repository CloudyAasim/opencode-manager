import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { ConfirmDestructiveDialog } from '@/components/ui/confirm-destructive-dialog'
import type { ProviderConflict } from '@/api/providerDeclarations'
import { useI18n } from '@/lib/i18n'

/**
 * Tells a tenant that an administrator declared an id they had already declared.
 *
 * It reports and it does not resolve. OpenCode merges a project configuration
 * over the global one, so the tenant's own copy is the one already in effect -
 * the conflict is visible because "already in effect" is not something a person
 * should have to infer, especially when the two definitions disagree about
 * where requests go.
 *
 * Two answers, and only two. Keeping theirs is recorded, so the prompt does not
 * come back on every reload; taking the global one removes their declaration,
 * which is the ordinary delete under a name that says why.
 */
export function ProviderConflictNotice({
  conflicts,
  onKeepMine,
  onUseGlobal,
  isPending,
}: {
  conflicts: ProviderConflict[]
  onKeepMine: (providerId: string) => void
  onUseGlobal: (providerId: string) => void
  isPending: boolean
}) {
  const { t } = useI18n()
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null)

  if (conflicts.length === 0) return null

  return (
    <div className="space-y-3">
      {conflicts.map((conflict) => (
        <Alert key={conflict.providerId} variant="destructive" data-conflict-id={conflict.providerId}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle className="flex flex-wrap items-center gap-2">
            {t('settingsPanels.provider.conflictTitle', { id: conflict.providerId })}
            {conflict.acknowledged && (
              <Badge variant="secondary">{t('settingsPanels.provider.conflictAcknowledged')}</Badge>
            )}
          </AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{t('settingsPanels.provider.conflictBody')}</p>
            <p className="text-xs">{t('settingsPanels.provider.conflictCurrent')}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => onKeepMine(conflict.providerId)}
              >
                {t('settingsPanels.provider.conflictKeepMine')}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={isPending}
                onClick={() => setPendingRemoval(conflict.providerId)}
              >
                {t('settingsPanels.provider.conflictUseGlobal')}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ))}

      <ConfirmDestructiveDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => !open && setPendingRemoval(null)}
        onConfirm={() => {
          if (pendingRemoval) onUseGlobal(pendingRemoval)
        }}
        onCancel={() => setPendingRemoval(null)}
        title={t('settingsPanels.provider.conflictUseGlobalTitle')}
        description={t('settingsPanels.provider.conflictUseGlobalDescription', { id: pendingRemoval ?? '' })}
        confirmLabel={t('settingsPanels.provider.conflictUseGlobalConfirm')}
        cancelLabel={t('common.cancel')}
        isPending={isPending}
      />
    </div>
  )
}
