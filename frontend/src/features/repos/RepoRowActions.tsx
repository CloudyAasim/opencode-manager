import { useState } from 'react'
import { Loader2, GitBranch, GitBranchPlus, Download, Trash2, MoreVertical, Pencil, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SourceControlPanel } from '@/features/source-control/SourceControlPanel'
import { DownloadDialog } from '@/components/ui/download-dialog'
import { CreateWorktreeDialog } from '@/features/repos/CreateWorktreeDialog'
import { RenameRepoDialog } from '@/features/repos/RenameRepoDialog'
import { ResetPermissionsDialog } from '@/features/repos/ResetPermissionsDialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { downloadRepo, renameRepo } from '@/api/repos'
import { showToast } from '@/lib/toast'
import { getRepoDisplayName } from '@/lib/utils'
import { invalidateRepoListCaches } from '@/lib/queryInvalidation'
import { useI18n } from '@/lib/i18n'

interface RepoRowActionsProps {
  repo: {
    id: number
    name?: string | null
    repoUrl?: string | null
    localPath?: string
    sourcePath?: string
    branch?: string
    currentBranch?: string
    cloneStatus: string
    isWorktree?: boolean
    isLocal?: boolean
    fullPath?: string
  }
  gitStatus?: {
    branch: string
    ahead: number
    behind: number
  }
  onDelete: (id: number) => void
  isDeleting: boolean
  isMobile: boolean
  onActionsOpenChange?: (isOpen: boolean) => void
}

export function RepoRowActions({
  repo,
  gitStatus,
  onDelete,
  isDeleting,
  isMobile,
  onActionsOpenChange,
}: RepoRowActionsProps) {
  const { t } = useI18n()
  const [showDownloadDialog, setShowDownloadDialog] = useState(false)
  const [showSourceControl, setShowSourceControl] = useState(false)
  const [showWorktreeDialog, setShowWorktreeDialog] = useState(false)
  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [showResetPermissions, setShowResetPermissions] = useState(false)

  const repoName = getRepoDisplayName(repo)
  const branchToDisplay = gitStatus?.branch || repo.currentBranch || repo.branch
  const isReady = repo.cloneStatus === 'ready'

  const queryClient = useQueryClient()
  const renameMutation = useMutation({
    mutationFn: (name: string | null) => renameRepo(repo.id, name),
    onSuccess: (updated) => {
      invalidateRepoListCaches(queryClient)
      queryClient.setQueryData(['repo', repo.id], updated)
      queryClient.invalidateQueries({ queryKey: ['all-schedules'] })
      queryClient.invalidateQueries({ queryKey: ['all-schedule-runs'] })
      queryClient.invalidateQueries({ queryKey: ['repo-schedules', repo.id] })
      showToast.success(t('repo.actions.renamed'))
    },
    onError: (error: unknown) => {
      showToast.error(error instanceof Error ? error.message : t('repo.actions.renameFailed'))
    },
  })

  const handleSourceControlOpen = (open: boolean) => {
    setShowSourceControl(open)
    onActionsOpenChange?.(open)
  }

  const handleRenameOpen = (open: boolean) => {
    setShowRenameDialog(open)
    onActionsOpenChange?.(open)
  }

  const handleDownloadDialogOpen = (open: boolean) => {
    setShowDownloadDialog(open)
    onActionsOpenChange?.(open)
  }

  const handleWorktreeDialogOpen = (open: boolean) => {
    setShowWorktreeDialog(open)
    onActionsOpenChange?.(open)
  }

  const canCreateWorktree = isReady && !repo.isWorktree && Boolean(repo.repoUrl)
  const deleteLabel = repo.isLocal ? t('repo.actions.unlinkRepository') : t('repo.actions.deleteRepository')

  const handleDownload = async (options: { includeGit?: boolean; includePaths?: string[] }) => {
    try {
      await downloadRepo(repo.id, repoName, options)
      showToast.success(t('repo.actions.downloadComplete'))
    } catch (error: unknown) {
      showToast.error(error instanceof Error ? error.message : t('repo.actions.downloadFailed'))
    }
  }

  if (isMobile) {
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={t('repo.actions.repositoryActions')}
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              title={t('repo.actions.repositoryActions')}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="z-[200]"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem
              onClick={() => handleSourceControlOpen(true)}
              disabled={!isReady}
            >
              <GitBranch className="w-4 h-4 mr-2" />
              {t('repo.actions.sourceControl')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setShowResetPermissions(true)}
              disabled={!isReady}
            >
              <ShieldAlert className="w-4 h-4 mr-2" />
              {t('repo.actions.resetPermissions')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleRenameOpen(true)}>
              <Pencil className="w-4 h-4 mr-2" />
              {t('repo.actions.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleDownloadDialogOpen(true)}
              disabled={!isReady}
            >
              <Download className="w-4 h-4 mr-2" />
              {t('repo.actions.download')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDelete(repo.id)}
              disabled={isDeleting}
              className="text-destructive"
            >
              {isDeleting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              {repo.isLocal ? t('repo.unlink') : t('repo.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <SourceControlPanel
          repoId={repo.id}
          isOpen={showSourceControl}
          onClose={() => {
            setShowSourceControl(false)
            onActionsOpenChange?.(false)
          }}
          currentBranch={branchToDisplay || ''}
          repoName={repoName}
        />
        <DownloadDialog
          open={showDownloadDialog}
          onOpenChange={(open) => {
            setShowDownloadDialog(open)
            onActionsOpenChange?.(open)
          }}
          onDownload={handleDownload}
          title={t('repo.download.repositoryTitle')}
          description={t('repo.download.repositoryDescription')}
          itemName={repoName}
          targetPath={repo.fullPath}
        />
        <RenameRepoDialog
          isOpen={showRenameDialog}
          currentName={repo.name ?? ''}
          derivedName={repoName}
          onClose={() => handleRenameOpen(false)}
          onSave={(name) => renameMutation.mutate(name)}
        />
        <ResetPermissionsDialog
          open={showResetPermissions}
          onOpenChange={setShowResetPermissions}
          repoId={repo.id}
        />
      </>
    )
  }

  return (
    <>
      <TooltipProvider delayDuration={200}>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('repo.actions.renameRepository')}
                size="sm"
                variant="ghost"
                onClick={() => handleRenameOpen(true)}
                className="h-8 w-8 p-0"
                title={t('repo.actions.renameRepository')}
              >
                <Pencil className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('repo.actions.renameRepository')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('repo.actions.sourceControl')}
                size="sm"
                variant="ghost"
                onClick={() => handleSourceControlOpen(true)}
                disabled={!isReady}
                className="h-8 w-8 p-0"
                title={t('repo.actions.sourceControl')}
              >
                <GitBranch className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('repo.actions.sourceControl')}</TooltipContent>
          </Tooltip>

          {canCreateWorktree && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('repo.actions.createWorktree')}
                  size="sm"
                  variant="ghost"
                  onClick={() => handleWorktreeDialogOpen(true)}
                  className="h-8 w-8 p-0"
                  title={t('repo.actions.createWorktree')}
                >
                  <GitBranchPlus className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('repo.actions.createWorktree')}</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                  aria-label={t('repo.actions.resetPermissions')}
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowResetPermissions(true)}
                  disabled={!isReady}
                  className="h-8 w-8 p-0"
                  title={t('repo.actions.resetPermissions')}
                >
                  <ShieldAlert className="w-4 h-4" />
                </Button>
            </TooltipTrigger>
            <TooltipContent>{t('repo.actions.resetPermissions')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('repo.actions.downloadRepository')}
                size="sm"
                variant="ghost"
                onClick={() => handleDownloadDialogOpen(true)}
                disabled={!isReady}
                className="h-8 w-8 p-0"
                title={t('repo.actions.downloadRepository')}
              >
                <Download className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('repo.actions.downloadRepository')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={deleteLabel}
                size="sm"
                variant="ghost"
                onClick={() => onDelete(repo.id)}
                disabled={isDeleting}
                className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                title={deleteLabel}
              >
                {isDeleting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{deleteLabel}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>

      <SourceControlPanel
        repoId={repo.id}
        isOpen={showSourceControl}
        onClose={() => { setShowSourceControl(false); onActionsOpenChange?.(false); }}
        currentBranch={branchToDisplay || ''}
        repoName={repoName}
      />
      <DownloadDialog
        open={showDownloadDialog}
        onOpenChange={(open) => { setShowDownloadDialog(open); onActionsOpenChange?.(open); }}
        onDownload={handleDownload}
        title={t('repo.download.repositoryTitle')}
        description={t('repo.download.repositoryDescription')}
        itemName={repoName}
        targetPath={repo.fullPath}
      />
      <CreateWorktreeDialog
        open={showWorktreeDialog}
        onOpenChange={handleWorktreeDialogOpen}
        repoId={repo.id}
        repoUrl={repo.repoUrl}
        defaultBaseBranch={branchToDisplay}
      />
      <RenameRepoDialog
        isOpen={showRenameDialog}
        currentName={repo.name ?? ''}
        derivedName={repoName}
        onClose={() => handleRenameOpen(false)}
        onSave={(name) => renameMutation.mutate(name)}
      />
      <ResetPermissionsDialog
        open={showResetPermissions}
        onOpenChange={setShowResetPermissions}
        repoId={repo.id}
      />
    </>
  )
}
