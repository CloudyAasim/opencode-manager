import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { settingsApi } from '@/api/settings'
import { invalidateSkillCaches } from '@/lib/queryInvalidation'
import { useI18n } from '@/lib/i18n'
import type { SkillFileInfo } from '@opencode-manager/shared'

export function useDeleteSkill() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [deleteSkill, setDeleteSkill] = useState<SkillFileInfo | null>(null)

  const deleteMutation = useMutation({
    mutationFn: ({ name, scope, repoId }: { name: string; scope: SkillFileInfo['scope']; repoId?: number }) =>
      settingsApi.deleteSkill(name, scope, repoId),
    onSuccess: () => {
      invalidateSkillCaches(queryClient)
      toast.success(t('settingsPanels.skillsEditor.toast.deleteSucceeded'))
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t('settingsPanels.skillsEditor.toast.deleteFailed'))
    },
  })

  const confirmDelete = () => {
    if (!deleteSkill) return
    deleteMutation.mutate({
      name: deleteSkill.name,
      scope: deleteSkill.scope,
      repoId: deleteSkill.scope === 'project' ? deleteSkill.repoId : undefined,
    }, {
      onSettled: () => setDeleteSkill(null),
    })
  }

  return { deleteSkill, setDeleteSkill, confirmDelete, isDeleting: deleteMutation.isPending }
}
