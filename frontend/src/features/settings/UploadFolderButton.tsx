import { useRef, useState } from 'react'
import { Upload, FileUp, FolderUp, ChevronDown } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { settingsApi } from '@/api/settings'
import { invalidateConfigCaches } from '@/lib/queryInvalidation'
import { useI18n } from '@/lib/i18n'
import { showErrorToast } from '@/lib/error-toast'

const DIRECTORY_INPUT_PROPS = {
  webkitdirectory: '',
  directory: '',
  mozdirectory: '',
} as React.InputHTMLAttributes<HTMLInputElement>

function isMarkdownFile(file: File): boolean {
  return (file.webkitRelativePath || file.name).toLowerCase().endsWith('.md')
}

interface UploadFolderButtonProps {
  kind: 'agents' | 'commands'
}

export function UploadFolderButton({ kind }: UploadFolderButtonProps) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const noun = t(kind === 'agents' ? 'settingsPanels.uploadFolder.nounAgent' : 'settingsPanels.uploadFolder.nounCommand')

  const openPicker = (inputRef: React.RefObject<HTMLInputElement | null>) => {
    requestAnimationFrame(() => inputRef.current?.click())
  }

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (selectedFiles.length === 0) {
      return
    }

    const files = selectedFiles.filter(isMarkdownFile)
    if (files.length === 0) {
      toast.error(t('settingsPanels.uploadFolder.noMarkdownFiles', { kind }))
      return
    }

    try {
      setIsUploading(true)
      const result = await settingsApi.installOpenCodeDirectoryFiles({ kind, files })
      invalidateConfigCaches(queryClient)
      toast.success(t('settingsPanels.uploadFolder.uploaded', { count: result.filesInstalled.length, noun }))
    } catch (error) {
      showErrorToast(error, t('settingsPanels.uploadFolder.uploadFailed', { kind }))
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={isUploading}>
            <Upload className="h-4 w-4 mr-1" />
            {isUploading ? t('settingsPanels.uploadFolder.uploading') : t('settingsPanels.uploadFolder.upload')}
            <ChevronDown className="h-4 w-4 ml-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => openPicker(fileInputRef)}>
            <FileUp className="h-4 w-4 mr-2" />
            {t('settingsPanels.uploadFolder.uploadFile')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openPicker(folderInputRef)}>
            <FolderUp className="h-4 w-4 mr-2" />
            {t('settingsPanels.uploadFolder.uploadFolder')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,text/markdown"
        className="sr-only"
        multiple
        disabled={isUploading}
        onChange={handleChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        accept=".md,text/markdown"
        className="sr-only"
        multiple
        disabled={isUploading}
        {...DIRECTORY_INPUT_PROPS}
        onChange={handleChange}
      />
    </>
  )
}
