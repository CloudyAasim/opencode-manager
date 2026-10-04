import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { FileBrowserView, type FileBrowserHandle } from './FileBrowserView'
import { useFileBrowserController, type FileBrowserController } from './useFileBrowserController'
import { getRepoRelativeDisplayPath } from '@/lib/display-path'
import { Button } from '@/components/ui/button'
import { PathDisplay } from '@/components/ui/path-display'
import { FullscreenSheet, FullscreenSheetHeader, FullscreenSheetContent } from '@/components/ui/fullscreen-sheet'
import { DownloadDialog } from '@/components/ui/download-dialog'
import { X, Download } from 'lucide-react'
import { GPU_ACCELERATED_STYLE, MODAL_TRANSITION_MS } from '@/lib/utils'
import { useSwipeBack } from '@/hooks/useMobile'
import { downloadDirectoryAsZip } from '@/api/files'
import { downloadRepo } from '@/api/repos'
import type { FileInfo } from '@/types/files'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/lib/i18n'

interface FileBrowserSheetProps {
  isOpen: boolean
  onClose: () => void
  basePath?: string
  repoName?: string
  repoId?: number
  initialSelectedFile?: string
  allowNavigateAboveBase?: boolean
  onFileSelect?: (file: FileInfo) => void
}

export const FileBrowserSheet = memo(function FileBrowserSheet({
  isOpen,
  onClose,
  basePath = '',
  repoName,
  repoId,
  initialSelectedFile,
  allowNavigateAboveBase = false,
  onFileSelect,
}: FileBrowserSheetProps) {
  const { t } = useI18n()
  const normalizedBasePath = basePath || '.'
  const [displayPath, setDisplayPath] = useState<string>('/')
  const [shouldRender, setShouldRender] = useState(false)
  const [currentPath, setCurrentPath] = useState<string>(basePath || '.')
  const [downloadDialog, setDownloadDialog] = useState<{ type: 'directory' | 'repository' } | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileBrowserRef = useRef<FileBrowserHandle>(null)

  const controller = useFileBrowserController({
    basePath: normalizedBasePath,
    initialSelectedFile,
    onFileSelect,
    onPreviewStateChange: setIsPreviewOpen,
    allowNavigateAboveBase,
  })

  const { bind, swipeStyles } = useSwipeBack(onClose, {
    enabled: isOpen && !isPreviewOpen,
    canBack: () => fileBrowserRef.current?.canGoBack() ?? false,
    onBack: () => fileBrowserRef.current?.goBack(),
  })

  useEffect(() => {
    return bind(containerRef.current)
  }, [bind])

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
    } else {
      setIsPreviewOpen(false)
      const timer = setTimeout(() => setShouldRender(false), MODAL_TRANSITION_MS)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  const handleDirectoryLoad = useCallback(
    (info: { workspaceRoot?: string; currentPath: string }) => {
      if (allowNavigateAboveBase) {
        const pathParts = info.currentPath.split('/').filter(Boolean)
        const displayParts = pathParts[0] === '..' ? ['workspace', ...pathParts.slice(1)] : ['workspace', 'repos', ...pathParts]
        setDisplayPath('/' + displayParts.join('/'))
        setCurrentPath(info.currentPath || '.')
        return
      }
      setCurrentPath(info.currentPath || '.')
      setDisplayPath(getRepoRelativeDisplayPath(info.currentPath || '.', normalizedBasePath))
    },
    [allowNavigateAboveBase, normalizedBasePath],
  )

  const openDownloadDialog = (type: 'directory' | 'repository') => setDownloadDialog({ type })

  const handleDownloadDirectory = async () => {
    if (!currentPath) return
    await downloadDirectoryAsZip(currentPath)
    setDownloadDialog(null)
  }

  const handleDownloadRepo = async () => {
    if (repoId != null) await downloadRepo(repoId, repoName ?? '')
    setDownloadDialog(null)
  }

  const mergedController: FileBrowserController = {
    ...controller,
    loadFiles: async (path: string) => {
      await controller.loadFiles(path)
      handleDirectoryLoad({
        workspaceRoot: controller.files?.workspaceRoot,
        currentPath: path,
      })
    },
    navigateUp: () => {
      controller.navigateUp()
      handleDirectoryLoad({
        workspaceRoot: controller.files?.workspaceRoot,
        currentPath: controller.currentPath,
      })
    },
  }

  if (!shouldRender) return null

  return (
    <div
      ref={containerRef}
      style={{
        ...GPU_ACCELERATED_STYLE,
        ...swipeStyles,
        pointerEvents: isOpen ? 'auto' : 'none',
        transition: 'opacity 150ms ease-out',
      }}
    >
      <FullscreenSheet>
        <FullscreenSheetHeader className="px-4 py-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
              {(displayPath === '/' || !repoName) && repoName && (
                <h1 className="text-sm font-semibold text-foreground shrink-0 truncate max-w-[150px]">
                  {repoName}
                </h1>
              )}
              <PathDisplay path={displayPath} maxSegments={4} className="truncate" />
            </div>
            <div className="flex items-center gap-2">
              {repoId != null && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200"
                      aria-label={t('repo.download.label')}
                      title={t('repo.download.label')}
                    >
                      <Download className="w-5 h-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openDownloadDialog('directory')}>
                      <Download className="w-4 h-4 mr-2" />
                      {t('repo.download.currentDirectory')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openDownloadDialog('repository')}>
                      <Download className="w-4 h-4 mr-2" />
                      {t('repo.download.entireRepository')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {(
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  aria-label={t('common.close')}
                  title={t('common.close')}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200"
                >
                  <X className="w-5 h-5" />
                </Button>
              )}
            </div>
          </div>
        </FullscreenSheetHeader>

        <FullscreenSheetContent>
          {shouldRender && (
            <FileBrowserView
              ref={fileBrowserRef}
              controller={mergedController}
              basePath={normalizedBasePath}
              showHeader={false}
              allowNavigateAboveBase={allowNavigateAboveBase}
            />
          )}
        </FullscreenSheetContent>
      </FullscreenSheet>

      <DownloadDialog
        open={downloadDialog !== null}
        onOpenChange={(open) => !open && setDownloadDialog(null)}
        onDownload={downloadDialog?.type === 'directory' ? handleDownloadDirectory : handleDownloadRepo}
        title={downloadDialog?.type === 'directory' ? t('repo.download.currentDirectoryTitle') : t('repo.download.repositoryTitle')}
        description={downloadDialog?.type === 'directory'
          ? t('repo.download.currentDirectoryDescription')
          : t('repo.download.repositoryDescription')}
        itemName={downloadDialog?.type === 'directory'
          ? currentPath.split('/').pop() || t('repo.download.directoryFallback')
          : repoName || t('repo.download.repositoryFallback')}
      />
    </div>
  )
})
