import { useState, useEffect } from 'react'
import { DialogLayout } from '@/components/ui/dialog-layout'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { getRepoDisplayName } from '@/lib/utils'
import { settingsApi } from '@/api/settings'
import { listRepos } from '@/api/repos'
import { FetchError } from '@/api/fetchWrapper'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n'
import type { SkillScope } from '@opencode-manager/shared'
import type { Repo } from '@/api/types'
import { showErrorToast } from '@/lib/error-toast'

interface SkillInstallDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInstalled: () => void
}

export function SkillInstallDialog({ open, onOpenChange, onInstalled }: SkillInstallDialogProps) {
  const { t } = useI18n()
  const [sourceType, setSourceType] = useState<'github' | 'upload'>('github')
  const [url, setUrl] = useState('')
  const [scope, setScope] = useState<SkillScope>('global')
  const [selectedRepoId, setSelectedRepoId] = useState<number | undefined>(undefined)
  const [files, setFiles] = useState<File[]>([])
  const [overwrite, setOverwrite] = useState(false)

  useEffect(() => {
    setOverwrite(false)
  }, [url, files, sourceType, scope, selectedRepoId])

  const resetForm = () => {
    setUrl('')
    setScope('global')
    setSelectedRepoId(undefined)
    setFiles([])
    setOverwrite(false)
  }

  const { data: repos = [] } = useQuery<Repo[]>({
    queryKey: ['repos'],
    queryFn: listRepos,
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const installMutation = useMutation({
    mutationFn: () => {
      if (sourceType === 'github') {
        return settingsApi.installSkillFromGithub({
          sourceType,
          url,
          scope,
          repoId: scope === 'project' ? selectedRepoId : undefined,
          overwrite: overwrite || undefined,
        })
      }
      return settingsApi.installSkillFromUpload({
        files,
        scope,
        repoId: scope === 'project' ? selectedRepoId : undefined,
        overwrite: overwrite || undefined,
      })
    },
    onSuccess: () => {
      toast.success(t('settingsPanels.skillInstall.toastInstalled'))
      resetForm()
      onInstalled()
      onOpenChange(false)
    },
    onError: (error) => {
      if (error instanceof FetchError && error.statusCode === 409) {
        setOverwrite(true)
        return
      }
      showErrorToast(error, t('settingsPanels.skillInstall.toastInstallFailed'))
    },
  })

  const handleSubmit = () => {
    if (sourceType === 'github' && !url.trim()) {
      toast.error(t('settingsPanels.skillInstall.toastEnterUrl'))
      return
    }
    if (sourceType === 'upload' && files.length === 0) {
      toast.error(t('settingsPanels.skillInstall.toastSelectFile'))
      return
    }
    if (scope === 'project' && !selectedRepoId) {
      toast.error(t('settingsPanels.skillInstall.toastSelectRepo'))
      return
    }
    installMutation.mutate()
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      resetForm()
    }
    onOpenChange(isOpen)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files
    if (selectedFiles) {
      setFiles(Array.from(selectedFiles))
    }
  }

  const selectedFileSummary = () => {
    if (files.length === 0) return null
    const relPath = files[0].webkitRelativePath || files[0].name
    return (
      <p className="text-sm text-muted-foreground">
        {t('settingsPanels.skillInstall.selectedFiles', { count: files.length, first: relPath })}
      </p>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent mobileFullscreen className="sm:max-w-lg sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6 pb-safe">
        <DialogLayout title={t('settingsPanels.skillInstall.title')}>
          <div className="space-y-4">
            <Tabs value={sourceType} onValueChange={(v) => setSourceType(v as 'github' | 'upload')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="github">{t('settingsPanels.skillInstall.githubTab')}</TabsTrigger>
                <TabsTrigger value="upload">{t('settingsPanels.skillInstall.uploadTab')}</TabsTrigger>
              </TabsList>

              <TabsContent value="github" className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label>{t('settingsPanels.skillInstall.githubUrl')}</Label>
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={t('settingsPanels.skillInstall.githubUrlPlaceholder')}
                  />
                </div>
              </TabsContent>

              <TabsContent value="upload" className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label>{t('settingsPanels.skillInstall.skillFile')}</Label>
                  <Input
                    type="file"
                    accept=".md,text/markdown"
                    onChange={handleFileChange}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('settingsPanels.skillInstall.skillFolder')}</Label>
                  <Input
                    type="file"
                    accept=".md,text/markdown"
                    {...{ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>}
                    onChange={handleFileChange}
                  />
                </div>
                {selectedFileSummary()}
              </TabsContent>
            </Tabs>

            <div className="space-y-2">
              <Label>{t('settingsPanels.skillInstall.scope')}</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as SkillScope)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('settingsPanels.skillInstall.selectScope')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">{t('settingsPanels.skillInstall.global')}</SelectItem>
                  <SelectItem value="project">{t('settingsPanels.skillInstall.project')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {scope === 'project' && (
              <div className="space-y-2">
                <Label>{t('settingsPanels.skillInstall.repository')}</Label>
                <Select
                  value={selectedRepoId?.toString()}
                  onValueChange={(value) => setSelectedRepoId(value ? parseInt(value, 10) : undefined)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('settingsPanels.skillInstall.selectRepository')} />
                  </SelectTrigger>
                  <SelectContent>
                    {repos.map((repo) => (
                      <SelectItem key={repo.id} value={repo.id.toString()}>
                        {getRepoDisplayName(repo)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {overwrite && (
              <Alert>
                <AlertDescription>
                  {t('settingsPanels.skillInstall.overwriteWarning')}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </DialogLayout>

        <DialogFooter className="flex flex-row gap-2 pt-2 border-t border-border sm:justify-end pb-4 p-3">
          <Button variant="outline" onClick={() => handleOpenChange(false)} className="flex-1 sm:flex-none">
            {t('settingsPanels.skillInstall.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={installMutation.isPending}
            className="flex-1 sm:flex-none"
          >
            {installMutation.isPending && t('settingsPanels.skillInstall.installing')}
            {!installMutation.isPending && (overwrite ? t('settingsPanels.skillInstall.overwriteAndInstall') : t('settingsPanels.skillInstall.install'))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
