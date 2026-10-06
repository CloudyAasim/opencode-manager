import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { ConfirmDestructiveDialog } from '@/components/ui/confirm-destructive-dialog'
import type { ProviderConflict } from '@/api/providerDeclarations'
import { useI18n } from '@/lib/i18n'

/**
 * Who is reading this, which decides whose side of the collision it is.
 *
 * A tenant is being told that somebody else declared an id they already had.
 * An administrator is being told that the copy they declared for the whole
 * server does not apply to *them*, because the personal copy they keep next to
 * their API key is merged over it. Same fact, opposite reading - and telling an
 * administrator "an administrator also declared this" would be telling them
 * about themselves.
 */
export type ProviderConflictVariant = 'tenant' | 'administrator'

/**
 * Reports that two declarations share an id. It reports, and it does not
 * resolve: OpenCode merges a project configuration over the global one, so the
 * personal copy is already the one in effect - the collision is visible because
 * "already in effect" is not something a person should have to infer, especially
 * when the two definitions disagree about where requests go.
 *
 * Two answers, and only two. Keeping theirs is recorded, so the prompt does not
 * come back on every reload; taking the global one removes their declaration,
 * which is the ordinary delete under a name that says why.
 */
export function ProviderConflictNotice({
  variant,
  conflicts,
  onKeepMine,
  onUseGlobal,
  isPending,
}: {
  variant: ProviderConflictVariant
  conflicts: ProviderConflict[]
  onKeepMine: (providerId: string) => void
  onUseGlobal: (providerId: string) => void
  isPending: boolean
}) {
  const { t } = useI18n()
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null)

  if (conflicts.length === 0) return null

  // The wording switches wholesale rather than by swapping a noun: "yours vs
  // theirs" and "mine vs the server's" are different sentences, not the same
  // sentence with the subject replaced.
  const prefix = variant === 'administrator' ? 'conflictAdmin' : 'conflict'
  const word = (key: string) => `settingsPanels.provider.${prefix}${key}`

  return (
    <div className="space-y-3">
      {conflicts.map((conflict) => (
        <Alert key={conflict.providerId} variant="destructive" data-conflict-id={conflict.providerId}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle className="flex flex-wrap items-center gap-2">
            {t(word('Title'), { id: conflict.providerId })}
            {conflict.acknowledged && (
              <Badge variant="secondary">{t('settingsPanels.provider.conflictAcknowledged')}</Badge>
            )}
          </AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{t(word('Body'), { id: conflict.providerId })}</p>
            <p className="text-xs">{t(word('Current'))}</p>
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
                {t(word('UseGlobal'))}
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
        title={t(word('UseGlobalTitle'), { id: pendingRemoval ?? '' })}
        description={t(word('UseGlobalDescription'), { id: pendingRemoval ?? '' })}
        confirmLabel={t(word('UseGlobalConfirm'))}
        cancelLabel={t('common.cancel')}
        isPending={isPending}
      />
    </div>
  )
}