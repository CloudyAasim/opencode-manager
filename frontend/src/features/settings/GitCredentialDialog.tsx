import { useState, useEffect } from 'react'
import { Loader2, Key, Lock, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { MultiSelect, type MultiSelectOption } from '@/components/ui/multi-select'
import { showToast } from '@/lib/toast'
import { getRepoDisplayName } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { GitCredential } from '@/api/types/settings'
import type { Repo } from '@/api/types'

export interface GitCredentialSaveOptions {
  makeDefault: boolean
  repoIds: number[]
}

interface GitCredentialDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (credential: GitCredential, options: GitCredentialSaveOptions) => Promise<void>
  credential?: GitCredential
  repos: Repo[]
  assignedRepoIds: number[]
  isDefault: boolean
  isSaving: boolean
}

export function GitCredentialDialog({ open, onOpenChange, onSave, credential, repos, assignedRepoIds, isDefault, isSaving }: GitCredentialDialogProps) {
  const { t } = useI18n()
  const [formData, setFormData] = useState<GitCredential>({
    name: '',
    host: '',
    type: 'pat',
    token: '',
    username: '',
    sshPrivateKey: '',
    passphrase: ''
  })
  const [tokenEdited, setTokenEdited] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [showPassphraseInput, setShowPassphraseInput] = useState(false)
  const [testPassphrase, setTestPassphrase] = useState('')
  const [makeDefault, setMakeDefault] = useState(false)
  const [selectedRepoIds, setSelectedRepoIds] = useState<number[]>([])

  const maskToken = (token: string) => {
    if (!token) return ''
    if (token.length <= 8) return '•'.repeat(token.length)
    return token.slice(0, 4) + '•'.repeat(Math.min(token.length - 4, 12)) + '...'
  }

  useEffect(() => {
    if (open) {
      setTokenEdited(false)
      setShowPassphraseInput(false)
      setTestPassphrase('')
      setMakeDefault(isDefault)
      setSelectedRepoIds(assignedRepoIds)
      if (credential) {
        setFormData({
          ...credential,
          sshPrivateKey: '',
          token: credential.type === 'pat' ? '' : credential.token
        })
      } else {
        setFormData({
          name: '',
          host: 'github.com',
          type: 'pat',
          token: '',
          username: '',
          sshPrivateKey: '',
          passphrase: ''
        })
      }
    }
  }, [open, credential, assignedRepoIds, isDefault])

  const normalizedHost = formData.host.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const isGithubPat = formData.type === 'pat' && normalizedHost === 'github.com'

  const repoOptions: MultiSelectOption[] = repos.map((repo) => ({
    value: String(repo.id),
    label: getRepoDisplayName(repo),
    description: repo.repoUrl || repo.fullPath,
  }))

  const handleSubmit = async (event?: React.MouseEvent) => {
    event?.preventDefault()
    event?.stopPropagation()

    if (!formData.name.trim() || !formData.host.trim()) {
      showToast.error(t('settingsPanels.gitCredential.nameHostRequired'))
      return
    }

    if (formData.type === 'pat') {
      if (!formData.token?.trim() && !(credential?.token && !tokenEdited)) {
        showToast.error(t('settingsPanels.gitCredential.tokenRequired'))
        return
      }
    } else if (formData.type === 'ssh') {
      if (!formData.sshPrivateKey?.trim()) {
        showToast.error(t('settingsPanels.gitCredential.sshRequired'))
        return
      }
    }

    try {
      const dataToSave: GitCredential = {
        ...formData,
        hasPassphrase: formData.type === 'ssh' ? Boolean(formData.passphrase?.trim()) : false
      }
      if (formData.type === 'pat' && credential?.token && !tokenEdited) {
        dataToSave.token = credential.token
      }
      await onSave(dataToSave, {
        makeDefault: isGithubPat && makeDefault,
        repoIds: isGithubPat ? selectedRepoIds : [],
      })
      setFormData({ name: '', host: '', type: 'pat', token: '', username: '', sshPrivateKey: '', passphrase: '' })
      onOpenChange(false)
    } catch {
      showToast.error(t('settingsPanels.gitCredential.saveFailed'))
    }
  }

  const handleTestConnection = async () => {
    if (!formData.sshPrivateKey?.trim()) {
      showToast.error(t('settingsPanels.gitCredential.enterSshKey'))
      return
    }

    setIsTesting(true)

    try {
      const host = formData.host.replace(/^https?:\/\//, '').replace(/\/$/, '')
      const settingsApi = (await import('@/api/settings')).settingsApi
      const result = await settingsApi.testSSHConnection(
        host,
        formData.sshPrivateKey,
        testPassphrase || undefined
      )

      if (result.success) {
        showToast.success(result.message)
      } else {
        showToast.error(result.message)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('settingsPanels.gitCredential.testFailed')
      showToast.error(message)
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobileFullscreen className="max-w-lg h-[90vh] sm:h-auto sm:max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0 px-4 sm:px-6 pt-4 sm:pt-6 pb-2 sm:pb-3">
          <DialogTitle>{credential ? t('settingsPanels.gitCredential.editTitle') : t('settingsPanels.gitCredential.addTitle')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
              className="flex-1 min-h-0 flex flex-col px-4 sm:px-6 py-2 sm:py-3 overflow-y-auto">
          <div className="space-y-4 sm:space-y-4 flex-shrink-0">
            <div className="space-y-2">
              <Label htmlFor="cred-name">{t('settingsPanels.gitCredential.name')}</Label>
              <Input
                id="cred-name"
                placeholder={t('settingsPanels.gitCredential.namePlaceholder')}
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                disabled={isSaving}
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cred-type">{t('settingsPanels.gitCredential.authType')}</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={formData.type === 'pat' ? 'default' : 'outline'}
                  onClick={() => setFormData({
                    ...formData,
                    type: 'pat',
                    host: formData.type === 'pat' ? formData.host : 'github.com',
                    sshPrivateKey: '',
                    passphrase: ''
                  })}
                  disabled={isSaving}
                  className="flex-1"
                >
                  <Key className="h-4 w-4 mr-2" />
                  {t('settingsPanels.gitCredential.pat')}
                </Button>
                <Button
                  type="button"
                  variant={formData.type === 'ssh' ? 'default' : 'outline'}
                  onClick={() => setFormData({
                    ...formData,
                    type: 'ssh',
                    host: formData.type === 'ssh' ? formData.host : 'github.com',
                    token: ''
                  })}
                  disabled={isSaving}
                  className="flex-1"
                >
                  <Lock className="h-4 w-4 mr-2" />
                  {t('settingsPanels.gitCredential.sshKey')}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cred-host">{t('settingsPanels.gitCredential.host')}</Label>
              <Input
                id="cred-host"
                placeholder={t('settingsPanels.gitCredential.hostPlaceholder')}
                value={formData.host}
                onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                disabled={isSaving}
                autoComplete="off"
              />
            </div>

            {formData.type === 'pat' ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="cred-token">
                    {credential?.token && !tokenEdited ? t('settingsPanels.gitCredential.accessTokenUnchanged') : t('settingsPanels.gitCredential.accessTokenRequired')}
                  </Label>
                  <Input
                    id="cred-token"
                    type="password"
                    placeholder={credential?.token ? maskToken(credential.token) : t('settingsPanels.gitCredential.personalAccessToken')}
                    value={formData.token || ''}
                    onChange={(e) => {
                      setTokenEdited(true)
                      setFormData({ ...formData, token: e.target.value })
                    }}
                    disabled={isSaving}
                    autoComplete="new-password"
                  />
                  {credential?.token && !tokenEdited && (
                    <p className="text-xs text-muted-foreground">
                      {t('settingsPanels.gitCredential.leaveEmptyKeep')}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cred-pat-username">{t('settingsPanels.gitCredential.usernameOptional')}</Label>
                  <Input
                    id="cred-pat-username"
                    placeholder={t('settingsPanels.gitCredential.usernamePlaceholder')}
                    value={formData.username || ''}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    disabled={isSaving}
                    autoComplete="off"
                  />
                </div>

                {isGithubPat && (
                  <div className="space-y-3 rounded-lg border border-border p-3">
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="cred-default-github-token"
                        checked={makeDefault}
                        onCheckedChange={(checked) => setMakeDefault(checked === true)}
                        disabled={isSaving}
                      />
                      <div className="space-y-1">
                        <Label htmlFor="cred-default-github-token">{t('settingsPanels.gitCredential.useAsDefault')}</Label>
                        <p className="text-xs text-muted-foreground">
                          {t('settingsPanels.gitCredential.useAsDefaultDescription')}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>{t('settingsPanels.gitCredential.useForRepos')}</Label>
                      {repos.length === 0 ? (
                        <p className="text-xs text-muted-foreground">{t('settingsPanels.gitCredential.noRepos')}</p>
                      ) : (
                        <MultiSelect
                          value={selectedRepoIds.map(String)}
                          onChange={(values) => setSelectedRepoIds(values.map(Number))}
                          options={repoOptions}
                          placeholder={t('settingsPanels.gitCredential.selectRepositories')}
                          searchPlaceholder={t('settingsPanels.gitCredential.searchRepositories')}
                          emptyMessage={t('settingsPanels.gitCredential.noRepositoriesFound')}
                          disabled={isSaving}
                        />
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="cred-ssh-key">{t('settingsPanels.gitCredential.sshPrivateKey')}</Label>
                  <Textarea
                    id="cred-ssh-key"
                    placeholder={t('settingsPanels.gitCredential.sshPrivateKeyPlaceholder')}
                    value={formData.sshPrivateKey || ''}
                    onChange={(e) => setFormData({ ...formData, sshPrivateKey: e.target.value })}
                    disabled={isSaving}
                    rows={10}
                    className="font-mono text-xs sm:text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('settingsPanels.gitCredential.pastePrivateKey')}
                  </p>
                </div>

                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowPassphraseInput(!showPassphraseInput)}
                    disabled={isSaving}
                    className="w-full"
                  >
                    {showPassphraseInput ? t('settingsPanels.gitCredential.removePassphrase') : t('settingsPanels.gitCredential.addPassphrase')}
                  </Button>
                </div>

                {showPassphraseInput && (
                  <div className="space-y-2">
                    <Label htmlFor="cred-passphrase">{t('settingsPanels.gitCredential.passphrase')}</Label>
                    <Input
                      id="cred-passphrase"
                      type="password"
                      placeholder={t('settingsPanels.gitCredential.passphrasePlaceholder')}
                      value={formData.passphrase || ''}
                      onChange={(e) => setFormData({ ...formData, passphrase: e.target.value })}
                      disabled={isSaving}
                      autoComplete="new-password"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('settingsPanels.gitCredential.passphraseDescription')}
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="test-passphrase">{t('settingsPanels.gitCredential.passphraseForTest')}</Label>
                  <Input
                    id="test-passphrase"
                    type="password"
                    placeholder={t('settingsPanels.gitCredential.passphraseForTestPlaceholder')}
                    value={testPassphrase}
                    onChange={(e) => setTestPassphrase(e.target.value)}
                    disabled={isTesting || isSaving}
                    autoComplete="new-password"
                  />
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={isTesting || isSaving || !formData.sshPrivateKey?.trim()}
                  className="w-full"
                >
                  {isTesting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {t('settingsPanels.gitCredential.testConnection')}
                </Button>

                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <p className="text-sm font-medium">{t('settingsPanels.gitCredential.securityNotice')}</p>
                  <p className="text-xs mt-1">
                    {t('settingsPanels.gitCredential.securityNoticeDescription')}
                  </p>
                </Alert>
              </>
            )}
          </div>
        </form>

        <DialogFooter className="p-3 sm:p-4 border-t gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
            className="flex-1 sm:flex-none"
          >
            {t('settingsPanels.gitCredential.cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving || !formData.name.trim() || !formData.host.trim() ||
                     (formData.type === 'pat' && !formData.token?.trim() && !(credential?.token && !tokenEdited)) ||
                     (formData.type === 'ssh' && !formData.sshPrivateKey?.trim())}
            className="flex-1 sm:flex-none"
          >
            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {credential ? t('settingsPanels.gitCredential.update') : t('settingsPanels.gitCredential.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
