import { useCallback, useRef, useState } from 'react'
import { FileBrowserView, type FileBrowserHandle } from './FileBrowserView'
import { useFileBrowserController } from './useFileBrowserController'
import { getRepoRelativeDisplayPath } from '@/lib/display-path'
import { Button } from '@/components/ui/button'
import { PathDisplay } from '@/components/ui/path-display'
import { DownloadDialog } from '@/components/ui/download-dialog'
import { downloadDirectoryAsZip } from '@/api/files'
import { downloadRepo } from '@/api/repos'
import { Download } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import type { FileInfo } from '@/types/files'
import { showToast } from '@/lib/toast'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface FileBrowserPageProps {
  basePath?: string
  repoName?: string
  repoId?: number
  allowNavigateAboveBase?: boolean
  onFileSelect?: (file: FileInfo) => void
}

export function FileBrowserPage({
  basePath = '',
  repoName,
  repoId,
  allowNavigateAboveBase = true,
  onFileSelect,
}: FileBrowserPageProps) {
  const fileBrowserRef = useRef<FileBrowserHandle>(null)
  // The listing tells us the real browse root. Without it the header has only
  // a relative path, which cannot say what it is relative to - and the last
  // version guessed, hardcoding a `workspace` prefix in front of whatever the
  // user was actually looking at.
  const [workspaceRoot, setWorkspaceRoot] = useState<string | undefined>(undefined)

  // Stable on purpose. `useFileBrowserController` takes this in the
  // dependencies of its `loadFiles` callback, which the initial-load effect
  // also depends on, so an inline arrow here re-created `loadFiles` on every
  // render and the effect reloaded the root for ever. Found by a test that
  // watched the network rather than the screen.
  const handleDirectoryLoad = useCallback((info: { workspaceRoot?: string; currentPath: string }) => {
    setWorkspaceRoot(info.workspaceRoot)
  }, [])

  const controller = useFileBrowserController({
    basePath,
    allowNavigateAboveBase,
    onFileSelect,
    onDirectoryLoad: handleDirectoryLoad,
  })


  const currentPath = controller.currentPath
  const displayPath = allowNavigateAboveBase
    ? currentPath
    : getRepoRelativeDisplayPath(currentPath, basePath)

  return (
    <div className="h-dvh max-h-dvh flex flex-col bg-background overflow-hidden pb-safe sm:pb-0">
      <FileBrowserHeader
        repoName={repoName}
        path={displayPath}
        workspaceRoot={workspaceRoot}
        repoId={repoId}
        basePath={basePath}
        onLoadDirectory={(p) => void controller.loadFiles(p)}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <FileBrowserView
          ref={fileBrowserRef}
          controller={controller}
          basePath={basePath}
          showPath={false}
          showHeader={false}
          allowNavigateAboveBase={allowNavigateAboveBase}
        />
      </div>
    </div>
  )
}

interface FileBrowserHeaderProps {
  repoName?: string
  path: string
  workspaceRoot?: string
  repoId?: number
  basePath: string
  onLoadDirectory: (path: string) => void
}

function FileBrowserHeader({ repoName, path, workspaceRoot, repoId, basePath }: FileBrowserHeaderProps) {
  const { t } = useI18n()
  const [downloadDialog, setDownloadDialog] = useState<{ type: 'directory' | 'repository' } | null>(null)

  const handleDownloadDirectory = async () => {
    if (!path) {
      showToast.error(t('repo.download.noPath'))
      return
    }
    try {
      await downloadDirectoryAsZip(path)
      showToast.success(t('repo.download.started'))
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : t('repo.download.failed'))
    } finally {
      setDownloadDialog(null)
    }
  }

  const handleDownloadRepo = async () => {
    if (repoId == null) {
      showToast.error(t('repo.download.noPath'))
      return
    }
    try {
      await downloadRepo(repoId, repoName ?? '')
      showToast.success(t('repo.download.started'))
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : t('repo.download.failed'))
    } finally {
      setDownloadDialog(null)
    }
  }

  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-2">
      {repoName && (
        <h1 className="text-sm font-semibold text-foreground shrink-0 truncate max-w-[120px] sm:max-w-[160px]">
          {repoName}
        </h1>
      )}
      <PathDisplay path={path} root={workspaceRoot} maxSegments={4} className="truncate flex-1 min-w-0" />
      {(repoId != null || basePath) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label={t('repo.download.label')}
              title={t('repo.download.label')}
            >
              <Download className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setDownloadDialog({ type: 'directory' })}>
              <Download className="w-4 h-4 mr-2" />
              {t('repo.download.currentDirectory')}
            </DropdownMenuItem>
            {repoId != null && (
              <DropdownMenuItem onClick={() => setDownloadDialog({ type: 'repository' })}>
                <Download className="w-4 h-4 mr-2" />
                {t('repo.download.entireRepository')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <DownloadDialog
        open={downloadDialog !== null}
        onOpenChange={(open) => !open && setDownloadDialog(null)}
        onDownload={downloadDialog?.type === 'directory' ? handleDownloadDirectory : handleDownloadRepo}
        title={downloadDialog?.type === 'directory' ? t('repo.download.currentDirectoryTitle') : t('repo.download.repositoryTitle')}
        description={downloadDialog?.type === 'directory'
          ? t('repo.download.currentDirectoryDescription')
          : t('repo.download.repositoryDescription')}
        itemName={downloadDialog?.type === 'directory'
          ? path.split('/').pop() || t('repo.download.directoryFallback')
          : repoName || t('repo.download.repositoryFallback')}
      />
    </header>
  )
}
