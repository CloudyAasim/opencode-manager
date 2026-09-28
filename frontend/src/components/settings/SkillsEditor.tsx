import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SkillDialog } from './SkillDialog'
import { SkillInstallDialog } from './SkillInstallDialog'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { SkillLibraryList } from '@/components/skills/SkillLibraryList'
import { settingsApi } from '@/api/settings'
import { useDeleteSkill } from '@/hooks/useDeleteSkill'
import { invalidateSkillCaches } from '@/lib/queryInvalidation'
import { useI18n } from '@/lib/i18n'
import type { SkillFileInfo, CreateSkillRequest, UpdateSkillRequest, SkillScope } from '@opencode-manager/shared'
import { toast } from 'sonner'
import { showErrorToast } from '@/lib/error-toast'

interface SkillsEditorProps {
  managedSkills?: SkillFileInfo[]
}

export function SkillsEditor({ managedSkills = [] }: SkillsEditorProps) {
  const { t } = useI18n()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const [editingSkill, setEditingSkill] = useState<SkillFileInfo | null>(null)
  const { deleteSkill, setDeleteSkill, confirmDelete, isDeleting } = useDeleteSkill()

  const queryClient = useQueryClient()

  const createMutation = useMutation({
    mutationFn: (data: CreateSkillRequest) => settingsApi.createSkill(data),
    onSuccess: () => {
      invalidateSkillCaches(queryClient)
      toast.success(t('settingsPanels.skillsEditor.created'))
      setDialogOpen(false)
    },
    onError: (error) => {
      showErrorToast(error, t('settingsPanels.skillsEditor.createFailed'))
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ name, scope, repoId, ...data }: UpdateSkillRequest & { name: string; scope: SkillScope; repoId?: number }) =>
      settingsApi.updateSkill(name, scope, data, repoId),
    onSuccess: () => {
      invalidateSkillCaches(queryClient)
      toast.success(t('settingsPanels.skillsEditor.updated'))
      setDialogOpen(false)
      setEditingSkill(null)
    },
    onError: (error) => {
      showErrorToast(error, t('settingsPanels.skillsEditor.updateFailed'))
    },
  })

  const handleEdit = (skill: SkillFileInfo) => {
    setEditingSkill(skill)
    setDialogOpen(true)
  }

  const handleCreate = () => {
    setEditingSkill(null)
    setDialogOpen(true)
  }

  const handleSubmit = (data: CreateSkillRequest | (UpdateSkillRequest & { name: string; scope: SkillScope; repoId?: number })) => {
    if ('name' in data && editingSkill) {
      updateMutation.mutate(data as UpdateSkillRequest & { name: string; scope: SkillScope; repoId?: number })
    } else {
      createMutation.mutate(data as CreateSkillRequest)
    }
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex items-center justify-end">
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Button type="button" variant="outline" onClick={() => setInstallDialogOpen(true)} size="sm">
            <Download className="h-4 w-4 mr-1" />
            {t('settingsPanels.skillsEditor.installSkill')}
          </Button>
          <Button type="button" onClick={handleCreate} size="sm" className="flex-1 sm:flex-none">
            <Plus className="h-4 w-4 mr-1" />
            {t('settingsPanels.skillsEditor.createSkill')}
          </Button>
        </div>
      </div>

      <SkillLibraryList
        isLoading={false}
        data={managedSkills}
        error={null}
        primaryAction={{ label: t('settingsPanels.skillsEditor.edit'), onClick: handleEdit }}
        rowActions={[{ label: t('settingsPanels.skillsEditor.delete'), onClick: setDeleteSkill, destructive: true }]}
        emptyTitle={t('settingsPanels.skillsEditor.emptyTitle')}
        emptyHint={t('settingsPanels.skillsEditor.emptyHint')}
        maxHeightClassName="max-h-[calc(100dvh-300px)] sm:max-h-[420px]"
      />

      <SkillInstallDialog
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
        onInstalled={() => invalidateSkillCaches(queryClient)}
      />

      <SkillDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        editingSkill={editingSkill}
      />

      <DeleteDialog
        open={deleteSkill !== null}
        onOpenChange={(open) => !open && setDeleteSkill(null)}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteSkill(null)}
        title={t('settingsPanels.skillsEditor.deleteTitle')}
        description={t('settingsPanels.skillsEditor.deleteDescription')}
        itemName={deleteSkill?.name}
        isDeleting={isDeleting}
      />
    </div>
  )
}
