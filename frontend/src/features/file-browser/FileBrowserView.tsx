import { forwardRef, useImperativeHandle, useRef, useCallback } from 'react'
import { FileTree } from './FileTree'
import { FilePreview } from './FilePreview'
import { MobileFilePreviewModal } from './MobileFilePreviewModal'
import { FileOperations } from './FileOperations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { RefreshCw, Upload, FolderOpen } from 'lucide-react'
import { useMobile } from '@/hooks/useMobile'
import { useFileBrowserController, type FileBrowserController } from './useFileBrowserController'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import { ResizableSplit } from '@/components/ui/resizable-split'
import { useI18n } from '@/lib/i18n'

export interface FileBrowserHandle {
  goBack: () => void
  canGoBack: () => boolean
  getCurrentPath: () => string
}

export interface FileBrowserProps {
  basePath?: string
  onFileSelect?: (file: import('@/types/files').FileInfo) => void
  onDirectoryLoad?: (info: { workspaceRoot?: string; currentPath: string }) => void
  onPreviewStateChange?: (open: boolean) => void
  embedded?: boolean
  initialSelectedFile?: string
  allowNavigateAboveBase?: boolean
}

export interface FileBrowserViewProps extends FileBrowserProps {
  controller?: FileBrowserController
  showPath?: boolean
  showHeader?: boolean
}

export const FileBrowserView = forwardRef<FileBrowserHandle, FileBrowserViewProps>(function FileBrowserView(
  props,
  ref,
) {
  const ownedController = useFileBrowserController({
    basePath: props.basePath,
    onFileSelect: props.onFileSelect,
    onDirectoryLoad: props.onDirectoryLoad,
    onPreviewStateChange: props.onPreviewStateChange,
    initialSelectedFile: props.initialSelectedFile,
    allowNavigateAboveBase: props.allowNavigateAboveBase,
  })
  const controller = props.controller ?? ownedController

  useImperativeHandle(
    ref,
    () => ({
      goBack: controller.navigateUp,
      canGoBack: controller.canNavigateUp,
      getCurrentPath: () => controller.currentPath,
    }),
    [controller.navigateUp, controller.canNavigateUp, controller.currentPath],
  )

  const { t } = useI18n()
  const isMobile = useMobile()
  const showPath = props.showPath ?? true
  const listRef = useRef<HTMLDivElement>(null)
  const dropZoneRef = controller.dropZoneRef
  const setDropZone = useCallback((node: HTMLDivElement | null) => {
    dropZoneRef.current = node
  }, [dropZoneRef])
  const setList = useCallback((node: HTMLDivElement | null) => {
    listRef.current = node
  }, [])
  const showHeader = props.showHeader ?? true

  const children = controller.files?.isDirectory ? (controller.files.children ?? []) : []
  const visibleFiles = controller.searchQuery
    ? children.filter((entry) => entry.name.toLowerCase().includes(controller.searchQuery.toLowerCase()))
    : children

  return (
    <>
      {showHeader && (
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5" />
              {showPath ? controller.currentPath || '/' : 'Files'}
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void controller.loadFiles(controller.currentPath)}
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
          {controller.error && (
            <div className="text-sm text-destructive bg-destructive/10 p-2 rounded mt-2">{controller.error}</div>
          )}
        </CardHeader>
      )}

      <CardContent className="flex-1 flex overflow-hidden min-h-0 p-0 relative">
        <ResizableSplit
          storageKey={STORAGE_KEYS.fileSplitPct}
          primaryLabel={t('repo.fileBrowser.listPane')}
          secondaryLabel={t('repo.fileBrowser.previewPane')}
          primaryClassName="flex flex-col min-h-0"
          primary={
            <>
        <div
          ref={setDropZone}
          {...controller.dragHandlers}
          className={`flex-1 flex flex-col min-h-0 outline-none ${isMobile ? '' : 'border-r'}`}
        >
          {controller.isDragging && (
            <div className="absolute inset-0 z-50 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <Upload className="w-12 h-12 mx-auto mb-2 text-primary" />
                <p className="text-lg font-semibold text-primary">{t('repo.fileBrowser.dropHere')}</p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 p-3 border-b flex-shrink-0">
            <Input
              placeholder={t('repo.fileBrowser.search')}
              value={controller.searchQuery}
              onChange={(e) => controller.setSearchQuery(e.target.value)}
              className="flex-1"
            />
            <FileOperations
              onUpload={(files) => void controller.upload(files)}
              onCreate={(name, type) => void controller.create(name, type)}
            />
          </div>

          {controller.uploadProgress && (
            <div className="px-3 py-2 border-b text-xs bg-muted/30 flex items-center justify-between">
              <span>
                {t('repo.fileBrowser.uploading', {
                  current: controller.uploadProgress.current,
                  total: controller.uploadProgress.total,
                })}
              </span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={controller.cancelUpload}>
                {t('repo.fileBrowser.cancel')}
              </Button>
            </div>
          )}

          <div ref={setList} data-testid="file-list-scroller" className="flex-1 min-h-0 overflow-y-auto">
            {controller.loading && !controller.files ? (
              <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-6 h-6 animate-spin" />
              </div>
            ) : (
              <FileTree
                files={visibleFiles}
                onFileSelect={(f) => void controller.selectFile(f)}
                selectedFile={controller.selectedFile}
                onDelete={controller.remove}
                onRename={controller.rename}
                onCopy={controller.copy}
                currentPath={controller.currentPath}
                basePath={props.basePath ?? ''}
                onNavigateUp={controller.navigateUp}
                canNavigateUp={controller.canNavigateUp()}
                scrollRef={listRef}
                expandedPaths={controller.expandedPaths}
                onToggleDirectory={controller.toggleDirectory}
                onLoadChildren={controller.loadChildren}
              />
            )}
          </div>
        </div>

            </>
          }
          secondary={
        !isMobile && (
          <div data-testid="file-preview-surface" className="hidden sm:flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {controller.selectedFile && !controller.selectedFile.isDirectory ? (
              <FilePreview
                key={controller.selectedFile.path}
                file={controller.selectedFile}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                {t('repo.fileBrowser.selectFile')}
              </div>
            )}
          </div>
        )
          }
        />
      </CardContent>

      <div data-testid="file-preview-modal-host" hidden={!controller.isPreviewModalOpen}>
        <MobileFilePreviewModal
          isOpen={controller.isPreviewModalOpen}
          onClose={controller.closePreview}
          file={controller.selectedFile}
        />
      </div>
    </>
  )
})

export const FileBrowser = forwardRef<FileBrowserHandle, FileBrowserProps>(function FileBrowser(props, ref) {
  return <FileBrowserView ref={ref} {...props} />
})
