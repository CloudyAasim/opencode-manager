import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AlertCircle, GitBranch, Loader2 } from 'lucide-react'
import { createRepo, listBranches } from '@/api/repos'
import { showToast } from '@/lib/toast'
import { invalidateRepoGitCaches } from '@/lib/queryInvalidation'
import { useI18n } from '@/lib/i18n'

interface CreateWorktreeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoId: number
  repoUrl?: string | null
  defaultBaseBranch?: string
  onCreated?: () => void
}

export function CreateWorktreeDialog({
  open,
  onOpenChange,
  repoId,
  repoUrl,
  defaultBaseBranch,
  onCreated,
}: CreateWorktreeDialogProps) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [branchName, setBranchName] = useState('')
  const [baseBranch, setBaseBranch] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const canCreate = Boolean(repoUrl)

  const { data: branchesData, isLoading: branchesLoading } = useQuery({
    queryKey: ['branches', repoId],
    queryFn: () => listBranches(repoId),
    enabled: open && canCreate,
    staleTime: 30000,
  })

  const localBranches = (branchesData?.branches ?? []).filter((b) => b.type === 'local')
  const remoteBranches = (branchesData?.branches ?? [])
    .filter((b) => b.type === 'remote')
    .map((b) => ({ ...b, shortName: b.name.replace(/^remotes\/[^/]+\//, '') }))
    .filter((b) => !localBranches.some((lb) => lb.name === b.shortName))

  useEffect(() => {
    if (!open) {
      setBranchName('')
      setBaseBranch('')
      setError(null)
      return
    }
    if (defaultBaseBranch) {
      setBaseBranch(defaultBaseBranch)
    }
  }, [open, defaultBaseBranch])

  const worktreeMutation = useMutation({
    mutationFn: (payload: { branch: string; base: string }) =>
      createRepo({
        repoUrl: repoUrl || undefined,
        branch: payload.branch,
        useWorktree: true,
        baseBranch: payload.base,
      }),
    onSuccess: () => {
      invalidateRepoGitCaches(queryClient, repoId)
      showToast.success(t('repo.worktreeCreation.created'))
      onCreated?.()
      onOpenChange(false)
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t('repo.worktreeCreation.createFailed'))
    },
  })

  const handleCreate = () => {
    const trimmed = branchName.trim()
    if (!trimmed) {
      setError(t('repo.worktreeCreation.branchRequired'))
      return
    }
    if (!baseBranch) {
      setError(t('repo.worktreeCreation.baseRequired'))
      return
    }
    setError(null)
    worktreeMutation.mutate({ branch: trimmed, base: baseBranch })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="w-4 h-4" />
            {t('repo.worktreeCreation.title')}
          </DialogTitle>
          <DialogDescription>
            {t('repo.worktreeCreation.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!canCreate ? (
            <div className="flex items-start gap-2 bg-warning border border-warning rounded p-3">
              <AlertCircle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
              <p className="text-sm text-warning">
                {t('repo.worktreeCreation.needsRemote')}
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>{t('repo.worktreeCreation.newBranchName')}</Label>
                <Input
                  placeholder={t('repo.worktreeCreation.newBranchPlaceholder')}
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !worktreeMutation.isPending) handleCreate()
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label>{t('repo.worktreeCreation.baseBranch')}</Label>
                <Select value={baseBranch} onValueChange={setBaseBranch} disabled={branchesLoading}>
                  <SelectTrigger className="bg-background border-border text-foreground">
                    <SelectValue placeholder={branchesLoading ? t('repo.worktreeCreation.loadingBranches') : t('repo.worktreeCreation.selectBaseBranch')} />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {localBranches.length > 0 && (
                      <>
                        {localBranches.map((branch) => (
                          <SelectItem key={`local-${branch.name}`} value={branch.name}>
                            <div className="flex items-center gap-2">
                              <GitBranch className="w-3.5 h-3.5" />
                              <span>{branch.name}</span>
                              {branch.current && (
                                <span className="text-xs text-muted-foreground">{t('repo.worktreeCreation.current')}</span>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </>
                    )}
                    {remoteBranches.map((branch) => (
                      <SelectItem key={`remote-${branch.name}`} value={branch.shortName}>
                        <div className="flex items-center gap-2">
                          <GitBranch className="w-3.5 h-3.5 text-primary" />
                          <span>{branch.shortName}</span>
                          <span className="text-xs text-muted-foreground">{t('repo.worktreeCreation.remote')}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t('repo.worktreeCreation.baseBranchHint')}
                </p>
              </div>
            </>
          )}

          {error && (
            <div className="flex items-start gap-2 bg-destructive border border-destructive rounded p-3">
              <AlertCircle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-border hover:bg-accent"
            >
              {t('repo.cancel')}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!canCreate || !branchName.trim() || !baseBranch || worktreeMutation.isPending}
              className="bg-primary hover:bg-primary disabled:opacity-50"
            >
              {worktreeMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t('repo.creating')}
                </>
              ) : (
                t('repo.worktreeCreation.title')
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
