import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { SettingsListRow } from '@/components/ui/settings-list'
import { settingsApi } from '@/api/settings'
import { invalidateConfigCaches } from '@/lib/queryInvalidation'
import { useI18n } from '@/lib/i18n'
import type { OpenCodeDirectoryFileInfo } from '@/api/types/settings'

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
      const result = await settingsApi.getOpenCodeDirectoryFile(kind, editingFile!.relativePath)
      setContent(result.content)
      return result
    },
    enabled: !!editingFile,
    staleTime: 0,
    gcTime: 0,
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      settingsApi.updateOpenCodeDirectoryFile({
        kind,
        relativePath: editingFile!.relativePath,
        content,
      }),
    onSuccess: () => {
      invalidateConfigCaches(queryClient)
      toast.success(t('settingsPanels.directoryFiles.fileSaved'))
      setEditingFile(null)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t('settingsPanels.directoryFiles.fileSaveFailed'))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => settingsApi.deleteOpenCodeDirectoryFile(kind, deletingFile!.relativePath),
    onSuccess: () => {
      invalidateConfigCaches(queryClient)
      toast.success(t('settingsPanels.directoryFiles.fileDeleted'))
      setDeletingFile(null)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t('settingsPanels.directoryFiles.fileDeleteFailed'))
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
        <DialogContent mobileFullscreen keyboardAware className="sm:max-w-2xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6 pb-safe">
          <DialogHeader className="p-4 sm:p-6 border-b">
            <DialogTitle className="break-all pr-8">{editingFile?.relativePath}</DialogTitle>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col p-2 sm:p-4">
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={isLoadingContent}
              aria-label={editingFile?.relativePath ?? t('settingsPanels.directoryFiles.fileContent')}
              className="h-full min-h-0 flex-1 field-sizing-fixed resize-none font-mono md:text-sm"
            />
          </div>

          <DialogFooter className="flex flex-row gap-2 pt-2 border-t border-border sm:justify-end pb-4 p-3">
            <Button variant="outline" onClick={() => setEditingFile(null)} className="h-11 flex-1 sm:h-9 sm:flex-none">
              {t('settingsPanels.directoryFiles.cancel')}
            </Button>
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={isLoadingContent || updateMutation.isPending}
              className="h-11 flex-1 sm:h-9 sm:flex-none"
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
