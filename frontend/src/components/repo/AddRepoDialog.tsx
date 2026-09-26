import { useState, useRef, useCallback, useMemo } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { listRepos, createRepo, discoverRepos } from '@/api/repos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DirectoryPickerDialog } from './DirectoryPickerDialog'
import { Loader2, FolderSearch } from 'lucide-react'
import { showToast } from '@/lib/toast'
import { invalidateRepoListCaches } from '@/lib/queryInvalidation'
import { getRepoBaseDirectoryName, getRepoDirectoryNameError, getRepoNameFromUrl, isSSHUrl, normalizeRepoUrlForCompare, sanitizeRepoDirectoryName } from '@opencode-manager/shared/utils'
import type { DiscoverReposResponse } from '@opencode-manager/shared/types'
import type { Repo } from '@/api/types'
import { useI18n } from '@/lib/i18n'

interface AddRepoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddRepoDialog({ open, onOpenChange }: AddRepoDialogProps) {
  const { t } = useI18n()
  const [repoType, setRepoType] = useState<'remote' | 'local' | 'folder'>('remote')
  const [repoUrl, setRepoUrl] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [folderPath, setFolderPath] = useState('')
  const [directoryName, setDirectoryName] = useState('')
  const [branch, setBranch] = useState('')
  const [skipSSHVerification, setSkipSSHVerification] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const directoryTouched = useRef(false)
  const queryClient = useQueryClient()

  const showSkipSSHCheckbox = repoType === 'remote' && isSSHUrl(repoUrl)
  const showDirectoryName = repoType === 'remote'

  const { data: existingRepos } = useQuery({
    queryKey: ['repos'],
    queryFn: listRepos,
    staleTime: 30_000,
  })

  const directoryNameError = useMemo(() => {
    if (!showDirectoryName || !directoryName) return null
    return getRepoDirectoryNameError(directoryName)
  }, [showDirectoryName, directoryName])

  const directoryCollision = useMemo(() => {
    if (!showDirectoryName || !directoryName || directoryNameError || !existingRepos) return null
    const normalizedNewUrl = normalizeRepoUrlForCompare(repoUrl)
    const colliding = existingRepos.find((r) => {
      if (r.localPath !== directoryName && getRepoBaseDirectoryName(r) !== directoryName) return false
      if (r.repoUrl && normalizeRepoUrlForCompare(r.repoUrl) === normalizedNewUrl) return false
      return true
    })
    return colliding ?? null
  }, [showDirectoryName, directoryName, directoryNameError, existingRepos, repoUrl])

  type AddRepoResult =
    | { mode: 'single'; repo: Repo }
    | ({ mode: 'discover' } & DiscoverReposResponse)

  const mutation = useMutation({
    mutationFn: async (): Promise<AddRepoResult> => {
      if (repoType === 'local') {
        const repo = await createRepo({ localPath, branch: branch || undefined, useWorktree: false })
        return { mode: 'single', repo }
      }

      if (repoType === 'folder') {
        const result = await discoverRepos(folderPath)
        return { mode: 'discover', ...result }
      }

      const repo = await createRepo({
        repoUrl,
        directoryName: directoryName || undefined,
        branch: branch || undefined,
        useWorktree: false,
        skipSSHVerification,
      })
      return { mode: 'single', repo }
    },
    onSuccess: (result) => {
      invalidateRepoListCaches(queryClient)
      setRepoUrl('')
      setLocalPath('')
      setFolderPath('')
      setDirectoryName('')
      setBranch('')
      setRepoType('remote')
      setSkipSSHVerification(false)
      directoryTouched.current = false

      if (result.mode === 'discover') {
        const summary = [
          result.discoveredCount > 0 ? t('repo.addDialog.discovery.newCount', { n: result.discoveredCount }) : null,
          result.existingCount > 0 ? t('repo.addDialog.discovery.existingCount', { n: result.existingCount }) : null,
        ].filter(Boolean).join(', ')

        if (result.errors.length > 0) {
          showToast.warning(t('repo.addDialog.discovery.completedWithIssues'), {
            description: `${summary || t('repo.addDialog.discovery.noReposImported')}. ${result.errors[0]?.error || t('repo.addDialog.discovery.someFoldersFailed')}`,
          })
        } else if (result.discoveredCount === 0 && result.existingCount === 0) {
          showToast.info(t('repo.addDialog.discovery.noneFound'))
        } else {
          showToast.success(t('repo.addDialog.discovery.complete'), {
            description: summary,
          })
        }
      } else {
        showToast.success(t('repo.addDialog.added'))
      }

      onOpenChange(false)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if ((repoType === 'remote' && repoUrl) || (repoType === 'local' && localPath) || (repoType === 'folder' && folderPath)) {
      mutation.mutate()
    }
  }

  const handleRepoUrlChange = useCallback((value: string) => {
    setRepoUrl(value)
    if (!isSSHUrl(value)) {
      setSkipSSHVerification(false)
    }
    if (!directoryTouched.current) {
      const extracted = sanitizeRepoDirectoryName(getRepoNameFromUrl(value))
      setDirectoryName(extracted)
    }
  }, [])

  const handleDirectoryNameChange = useCallback((value: string) => {
    directoryTouched.current = true
    setDirectoryName(value)
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobileFullscreen mobileSwipeToClose className="content-start gap-0 sm:max-w-[500px] sm:max-h-[80vh] sm:h-auto sm:top-[50%] sm:translate-y-[-50%] bg-card border-border">
        <DialogHeader className="px-4 sm:px-6 pt-2 sm:pt-6 pb-2 sm:pb-3 h-fit">
          <DialogTitle className="text-xl text-foreground">
            {t('repo.addRepository')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 px-4 sm:px-6">
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">{t('repo.addDialog.type')}</label>
            <Tabs value={repoType} onValueChange={(value) => setRepoType(value as 'remote' | 'local' | 'folder')}>
              <TabsList className="grid w-full grid-cols-3 bg-muted">
                <TabsTrigger value="remote">{t('repo.addDialog.remote')}</TabsTrigger>
                <TabsTrigger value="local">{t('repo.addDialog.local')}</TabsTrigger>
                <TabsTrigger value="folder">{t('repo.addDialog.folder')}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {repoType === 'remote' ? (
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">{t('repo.addDialog.repositoryUrl')}</label>
              <Input
                placeholder={t('repo.addDialog.repositoryUrlPlaceholder')}
                value={repoUrl}
                onChange={(e) => handleRepoUrlChange(e.target.value)}
                disabled={mutation.isPending}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground min-h-[44px] text-base"
              />
              <p className="text-xs text-muted-foreground">
                {t('repo.addDialog.repositoryUrlHint')}
              </p>
            </div>
          ) : repoType === 'local' ? (
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">{t('repo.addDialog.localPath')}</label>
              <div className="flex gap-2">
                <Input
                  placeholder={t('repo.addDialog.localPathPlaceholder')}
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  disabled={mutation.isPending}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground min-h-[44px] text-base"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPickerOpen(true)}
                  disabled={mutation.isPending}
                  className="min-h-[44px] shrink-0 border-border bg-muted px-3 text-muted-foreground hover:bg-accent"
                  aria-label={t('repo.addDialog.browseForFolder')}
                >
                  <FolderSearch className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('repo.addDialog.localPathHint')}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">{t('repo.addDialog.folderPath')}</label>
              <div className="flex gap-2">
                <Input
                  placeholder={t('repo.addDialog.folderPathPlaceholder')}
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  disabled={mutation.isPending}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground min-h-[44px] text-base"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPickerOpen(true)}
                  disabled={mutation.isPending}
                  className="min-h-[44px] shrink-0 border-border bg-muted px-3 text-muted-foreground hover:bg-accent"
                  aria-label={t('repo.addDialog.browseForFolder')}
                >
                  <FolderSearch className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('repo.addDialog.folderPathHint')}
              </p>
            </div>
          )}

          {showDirectoryName && (
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">{t('repo.addDialog.directoryName')}</label>
              <Input
                placeholder={t('repo.addDialog.directoryNamePlaceholder')}
                value={directoryName}
                onChange={(e) => handleDirectoryNameChange(e.target.value)}
                disabled={mutation.isPending}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground min-h-[44px] text-base"
              />
              {directoryNameError ? (
                <p className="text-xs text-amber-400">
                  {directoryNameError}.
                </p>
              ) : directoryCollision ? (
                <p className="text-xs text-amber-400">
                  {t('repo.addDialog.directoryCollision', { name: directoryName })}
                  {directoryCollision.repoUrl && directoryCollision.repoUrl !== repoUrl
                    ? ` (${directoryCollision.repoUrl})`
                    : ''
                  }
                  {' '}{t('repo.addDialog.directoryCollisionChoose')}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t('repo.addDialog.directoryNameHint')}
                </p>
              )}
            </div>
          )}
          
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">{t('repo.addDialog.branchOptional')}</label>
            <Input
              placeholder={t('repo.addDialog.branchPlaceholder')}
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              disabled={mutation.isPending || repoType === 'folder'}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground min-h-[44px] text-base"
            />
            <p className="text-xs text-muted-foreground">
              {repoType === 'folder' 
                ? t('repo.addDialog.branchHintFolder')
                : branch 
                  ? t('repo.addDialog.branchHintSelected', { branch })
                  : t('repo.addDialog.branchHintDefault')
              }
            </p>
          </div>

          {showSkipSSHCheckbox && (
            <div className="flex items-start space-x-3">
              <input
                type="checkbox"
                id="skip-ssh-verification"
                checked={skipSSHVerification}
                onChange={(e) => setSkipSSHVerification(e.target.checked)}
                disabled={mutation.isPending}
                className="mt-1 h-5 w-5 rounded border-border bg-muted text-primary focus:ring-primary"
              />
              <div className="flex-1">
                <label htmlFor="skip-ssh-verification" className="cursor-pointer text-sm text-foreground">
                  {t('repo.addDialog.skipSshVerification')}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t('repo.addDialog.skipSshVerificationHint')}
                </p>
              </div>
            </div>
          )}

          <Button 
            type="submit" 
            disabled={(!repoUrl && repoType === 'remote') || (!localPath && repoType === 'local') || (!folderPath && repoType === 'folder') || mutation.isPending || (showDirectoryName && (!!directoryNameError || !!directoryCollision))}
            className="w-full min-h-[48px] bg-primary hover:bg-primary-hover text-primary-foreground text-base font-medium"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {repoType === 'local' ? t('repo.addDialog.linking') : repoType === 'folder' ? t('repo.addDialog.discovering') : t('repo.cloning')}
              </>
            ) : (
              repoType === 'folder' ? t('repo.addDialog.discoverRepositories') : t('repo.addRepository')
            )}
          </Button>
          {mutation.isError && (
            <p className="text-sm text-red-400">
              {mutation.error.message}
            </p>
          )}
        </form>
      </DialogContent>
      <DirectoryPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={repoType === 'folder' ? t('repo.addDialog.selectFolderToScan') : t('repo.addDialog.selectLocalRepository')}
        onSelect={(path) => {
          if (repoType === 'folder') {
            setFolderPath(path)
          } else {
            setLocalPath(path)
          }
        }}
      />
    </Dialog>
  )
}
