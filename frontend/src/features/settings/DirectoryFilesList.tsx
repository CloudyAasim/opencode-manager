import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { DialogTitleBar } from '@/components/ui/dialog-layout'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { SettingsListRow } from '@/components/ui/settings-list'
import { settingsApi } from '@/api/settings'
import { invalidateConfigCaches } from '@/lib/queryInvalidation'
import { useI18n } from '@/lib/i18n'
import type { OpenCodeDirectoryFileInfo } from '@/api/types/settings'
import { showErrorToast } from '@/lib/error-toast'

interface DirectoryFilesListProps {
  kind: 'agents' | 'commands'
  files: OpenCodeDirectoryFileInfo[]
}

export function DirectoryFilesList({ kind, files }: DirectoryFilesListProps) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [editingFile, setEditingFile] = useState<OpenCodeDirectoryFileInfo | null>(null)
  const [deletingFile, setDeletingFile] = useState<OpenCodeDirectoryFileInfo | null>(null)
  const [content, setContent] = useState('')

  const { isFetching: isLoadingContent } = useQuery({
    queryKey: ['opencode-directory-file', kind, editingFile?.relativePath],
    queryFn: async () => {
      const path = editingFile?.relativePath
      if (!path) throw new Error('No file selected')
      const result = await settingsApi.getOpenCodeDirectoryFile(kind, path)
      setContent(result.content)
      return result
    },
    enabled: !!editingFile,
    staleTime: 0,
    gcTime: 0,
  })

  const updateMutation = useMutation({
    mutationFn: () => {
      const path = editingFile?.relativePath
      if (!path) throw new Error('No file selected')
      return settingsApi.updateOpenCodeDirectoryFile({ kind, relativePath: path, content })
    },
    onSuccess: () => {
      invalidateConfigCaches(queryClient)
      toast.success(t('settingsPanels.directoryFiles.fileSaved'))
      setEditingFile(null)
    },
    onError: (error) => {
      showErrorToast(error, t('settingsPanels.directoryFiles.fileSaveFailed'))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => {
      const path = deletingFile?.relativePath
      if (!path) throw new Error('No file selected')
      return settingsApi.deleteOpenCodeDirectoryFile(kind, path)
    },
    onSuccess: () => {
      invalidateConfigCaches(queryClient)
      toast.success(t('settingsPanels.directoryFiles.fileDeleted'))
      setDeletingFile(null)
    },
    onError: (error) => {
      showErrorToast(error, t('settingsPanels.directoryFiles.fileDeleteFailed'))
    },
  })

  return (
    <>
      {files.map((file) => {
        const isNested = file.relativePath.includes('/')
        return (
          <SettingsListRow
            key={`file:${file.relativePath}`}
            title={<span title={file.relativePath}>{file.name}</span>}
            description={isNested ? t('settingsPanels.directoryFiles.uploadedFile', { path: file.relativePath }) : undefined}
            badges={<Badge variant="secondary" className="shrink-0">{t('settingsPanels.directoryFiles.file')}</Badge>}
            onClick={() => setEditingFile(file)}
            primaryAction={{ label: t('settingsPanels.directoryFiles.edit'), onClick: () => setEditingFile(file) }}
            actions={[{ label: t('settingsPanels.directoryFiles.delete'), destructive: true, onClick: () => setDeletingFile(file) }]}
            actionsLabel={t('settingsPanels.directoryFiles.actionsFor', { name: file.name })}
          />
        )
      })}

      <Dialog open={!!editingFile} onOpenChange={(open) => !open && setEditingFile(null)}>
        <DialogContent width="2xl" mobileFullscreen keyboardAware className="sm:max-h-[85vh] gap-0 sm:gap-4 flex flex-col pb-safe sm:pb-6">
          <DialogTitleBar title={editingFile?.relativePath} titleClassName="break-all pr-8" />
          <div className="flex min-h-0 flex-1 flex-col">
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={isLoadingContent}
              aria-label={editingFile?.relativePath ?? t('settingsPanels.directoryFiles.fileContent')}
              className="h-full min-h-0 flex-1 field-sizing-fixed resize-none font-mono"
            />
          </div>

          <DialogFooter variant="divided" className="pt-2">
            <Button variant="outline" onClick={() => setEditingFile(null)} size="touch" className="flex-1 sm:flex-none">
              {t('settingsPanels.directoryFiles.cancel')}
            </Button>
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={isLoadingContent || updateMutation.isPending}
              size="touch" className="flex-1 sm:flex-none"
            >
              {updateMutation.isPending ? t('settingsPanels.directoryFiles.saving') : t('settingsPanels.directoryFiles.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteDialog
        open={!!deletingFile}
        onOpenChange={(open) => !open && setDeletingFile(null)}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setDeletingFile(null)}
        title={t('settingsPanels.directoryFiles.deleteTitle')}
        description={t('settingsPanels.directoryFiles.deleteDescription')}
        itemName={deletingFile?.relativePath}
        isDeleting={deleteMutation.isPending}
      />
    </>
  )
}
