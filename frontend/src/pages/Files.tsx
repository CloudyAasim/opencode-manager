import { FileBrowserPage } from '@/features/file-browser/FileBrowserPage'
import { useI18n } from '@/lib/i18n'
import { useState } from 'react'
import type { FileInfo } from '@/types/files'

export function Files() {
  const { t } = useI18n()
  const [, setSelected] = useState<FileInfo | null>(null)

  return (
    <FileBrowserPage
      basePath=""
      allowNavigateAboveBase
      repoName={t('navigation.files')}
      onFileSelect={setSelected}
    />
  )
}
