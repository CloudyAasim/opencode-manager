import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { DialogTitleBar } from '@/components/ui/dialog-layout'
import { Button } from '@/components/ui/button'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { SkillLibraryList } from '@/components/skills/SkillLibraryList'
import { SkillInstallDialog } from '@/features/settings/SkillInstallDialog'
import { settingsApi } from '@/api/settings'
import { useLoadSkill } from '@/hooks/useOpenCode'
import { useDeleteSkill } from '@/hooks/useDeleteSkill'
import { invalidateSkillCaches } from '@/lib/queryInvalidation'
import type { SkillFileInfo } from '@opencode-manager/shared'
import { useI18n } from '@/lib/i18n'

type RepoSkillsDialogBaseProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoId: number
}

type RepoSkillsDialogProps = RepoSkillsDialogBaseProps & (
  | { sessionId: string; opcodeUrl: string; directory?: string; onSkillLoaded?: (skill: SkillFileInfo) => void }
  | { sessionId?: undefined; opcodeUrl?: undefined; directory?: undefined; onSkillLoaded?: undefined }
)

export function RepoSkillsDialog({
  open,
  onOpenChange,
  repoId,
  sessionId,
  opcodeUrl,
  directory,
  onSkillLoaded,
}: RepoSkillsDialogProps) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const { deleteSkill, setDeleteSkill, confirmDelete, isDeleting } = useDeleteSkill()
  const skillsQueryKey = directory ? ['settings', 'skills', 'directory', directory] : ['settings', 'skills', repoId]

  const { isLoading, data, error } = useQuery({
    queryKey: skillsQueryKey,
    queryFn: () => settingsApi.listManagedSkills(repoId, directory),
    enabled: open && (!!repoId || !!directory),
    staleTime: 30000,
  })

  const canLoad = !!sessionId && !!opcodeUrl
  const loadSkill = useLoadSkill(opcodeUrl, sessionId, directory)

  const handleLoad = (skill: SkillFileInfo) => {
    loadSkill.mutate({ skillName: skill.name })
    onSkillLoaded?.(skill)
    onOpenChange(false)
  }

  const handleInstalled = () => {
    invalidateSkillCaches(queryClient)
  }

  if (!repoId && !sessionId) {
    return null
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent height="tall" width="3xl" mobileFullscreen className="gap-0 sm:gap-4 flex flex-col pb-safe sm:pb-6">
          <DialogTitleBar
            title={t('repo.skills.title')}
            description={canLoad ? t('repo.skills.descriptionLoad') : t('repo.skills.descriptionAvailable')}
          >
            <Button type="button" variant="outline" size="sm" onClick={() => setInstallDialogOpen(true)}>
                <Download className="size-4 mr-1" />
                {t('repo.skills.install')}
              </Button>
          </DialogTitleBar>
          <div className="flex-1 overflow-y-auto">
            <SkillLibraryList
              isLoading={isLoading}
              data={data}
              error={error as Error | null}
              primaryAction={canLoad ? { label: t('repo.skills.load'), onClick: handleLoad } : undefined}
              rowActions={[{ label: t('repo.delete'), onClick: setDeleteSkill, destructive: true }]}
              emptyTitle={t('repo.skills.emptyTitle')}
              emptyHint={t('repo.skills.emptyHint')}
              maxHeightClassName="max-h-[55vh]"
            />
          </div>
        </DialogContent>
      </Dialog>

      <SkillInstallDialog
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
        onInstalled={handleInstalled}
      />

      <DeleteDialog
        open={deleteSkill !== null}
        onOpenChange={(isOpen) => !isOpen && setDeleteSkill(null)}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteSkill(null)}
        title={t('repo.skills.deleteTitle')}
        description={t('repo.skills.deleteDescription')}
        itemName={deleteSkill?.name}
        isDeleting={isDeleting}
      />
    </>
  )
}
