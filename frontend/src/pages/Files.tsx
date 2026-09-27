import { useState } from 'react'
import { FileTreeExplorer } from '@/components/file-browser/FileTreeExplorer'
import { FilePreview } from '@/components/file-browser/FilePreview'
import { resolvePreviewFile } from '@/components/file-browser/resolve-preview-file'
import { Header } from '@/components/ui/header'
import type { FileInfo } from '@/types/files'
import { useI18n } from '@/lib/i18n'

export function Files() {
  const { t } = useI18n()
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null)

  const handleSelectFile = async (file: FileInfo) => {
    setSelectedFile(file)
    const resolved = await resolvePreviewFile(file)
    if (!file.isDirectory) setSelectedFile(resolved)
  }

  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-background flex flex-col pb-[calc(env(safe-area-inset-bottom)+56px)] sm:pb-0">
      <Header>
        <Header.Title>{t('navigation.files')}</Header.Title>
      </Header>
      <div className="flex flex-1 min-h-0">
        <aside className="w-full sm:w-80 sm:shrink-0 sm:border-r sm:border-border min-h-0 overflow-hidden">
          <FileTreeExplorer
            rootPath=""
            selectedPath={selectedFile?.path}
            onSelectFile={handleSelectFile}
          />
        </aside>
        <div className="hidden sm:flex flex-1 min-h-0 overflow-y-auto">
          {selectedFile && !selectedFile.isDirectory ? (
            <FilePreview key={selectedFile.path} file={selectedFile} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              {t('repo.fileBrowser.selectFileToPreview')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
