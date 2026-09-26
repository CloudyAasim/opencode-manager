import { useState } from 'react'
import { Edit2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { Loader2, User, KeyRound, LogOut, Plus, Trash2, AlertCircle, CheckCircle, Lock } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { passkey, changePassword } from '@/lib/auth-client'
import { useI18n } from '@/lib/i18n'

interface Passkey {
  id: string
  name?: string
  credentialID: string
  createdAt: string
  deviceType: string
}

export function AccountSettings() {
  const { t } = useI18n()
  const { user, addPasskey, logout } = useAuth()
  const queryClient = useQueryClient()
  const [passkeyName, setPasskeyName] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)
  const [deletePasskeyId, setDeletePasskeyId] = useState<string | null>(null)

  const { data: passkeys, isLoading: passkeysLoading } = useQuery({
    queryKey: ['passkeys'],
    queryFn: async () => {
      const response = await fetch('/api/auth/passkey/list-user-passkeys', {
        credentials: 'include',
      })
      if (!response.ok) return []
      return response.json() as Promise<Passkey[]>
    },
    enabled: !!user,
  })

  const addPasskeyMutation = useMutation({
    mutationFn: async (name: string) => {
      return addPasskey(name || undefined)
    },
    onSuccess: (result) => {
      if (result.error) {
        setError(result.error)
      } else {
        setSuccess(t('settingsPanels.account.passkeyAdded'))
        setPasskeyName('')
        queryClient.invalidateQueries({ queryKey: ['passkeys'] })
      }
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t('settingsPanels.account.passkeyAddFailed'))
    },
  })

  const deletePasskeyMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await passkey.deletePasskey({ id })
      if (response.error) {
        throw new Error(response.error.message || t('settingsPanels.account.passkeyDeleteFailed'))
      }
      return response.data
    },
    onSuccess: () => {
      setSuccess(t('settingsPanels.account.passkeyDeleted'))
      queryClient.invalidateQueries({ queryKey: ['passkeys'] })
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t('settingsPanels.account.passkeyDeleteFailed'))
    },
  })

  const changePasswordMutation = useMutation({
    mutationFn: async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) => {
      const response = await changePassword({ currentPassword, newPassword, revokeOtherSessions: true })
      if (response.error) {
        throw new Error(response.error.message || t('settingsPanels.account.passwordChangeFailed'))
      }
      return response.data
    },
    onSuccess: () => {
      setSuccess(t('settingsPanels.account.passwordChanged'))
      setCurrentPassword('')
      setNewPassword('')
      setShowChangePassword(false)
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t('settingsPanels.account.passwordChangeFailed'))
    },
  })

  const handleAddPasskey = async () => {
    setError(null)
    setSuccess(null)
    addPasskeyMutation.mutate(passkeyName)
  }

  const handleDeletePasskey = (id: string) => {
    setError(null)
    setSuccess(null)
    setDeletePasskeyId(id)
  }

  const handleDeleteConfirm = () => {
    if (deletePasskeyId) {
      deletePasskeyMutation.mutate(deletePasskeyId)
      setDeletePasskeyId(null)
    }
  }

  const handleDeleteCancel = () => {
    setDeletePasskeyId(null)
  }

  const handleChangePassword = () => {
    setError(null)
    setSuccess(null)
    if (newPassword.length < 8) {
      setError(t('settingsPanels.account.newPasswordMin'))
      return
    }
    changePasswordMutation.mutate({ currentPassword, newPassword })
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="border-green-500 text-green-700 dark:text-green-400">
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 sm:gap-6 @min-[1000px]:grid-cols-3 @min-[1000px]:items-start">
        <div className="min-w-0 space-y-4 sm:space-y-6">
          <Card className="border-0 shadow-none">
            <CardHeader className="pb-3 sm:pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 sm:h-5 sm:w-5" />
                  <CardTitle className="text-base sm:text-lg">{t('settingsPanels.account.profile')}</CardTitle>
                </div>
                {!editingProfile && (
                  <Button variant="ghost" size="sm" onClick={() => setEditingProfile(true)} className="h-8">
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {editingProfile ? (
                <div className="space-y-3 sm:space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs sm:text-sm">{t('settingsPanels.account.name')}</Label>
                    <Input value={user.name} disabled className="h-9 sm:h-10 md:text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs sm:text-sm">{t('settingsPanels.account.email')}</Label>
                    <Input value={user.email} disabled className="h-9 sm:h-10 md:text-sm" />
                  </div>
                  <Button variant="outline" onClick={() => setEditingProfile(false)} className="h-9 sm:h-10">
                    {t('settingsPanels.account.done')}
                  </Button>
                </div>
              ) : (
                <div className="space-y-2 sm:space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
                    <span className="text-xs sm:text-sm text-muted-foreground sm:w-20">{t('settingsPanels.account.name')}</span>
                    <span className="text-sm font-medium truncate">{user.name}</span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
                    <span className="text-xs sm:text-sm text-muted-foreground sm:w-20">{t('settingsPanels.account.email')}</span>
                    <span className="text-sm truncate">{user.email}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-none">
            <CardHeader className="pb-2 sm:pb-4">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <Lock className="h-4 w-4 sm:h-5 sm:w-5" />
                {t('settingsPanels.account.changePassword')}
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">{t('settingsPanels.account.changePasswordDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              {!showChangePassword ? (
                <Button
                  variant="outline"
                  onClick={() => setShowChangePassword(true)}
                  className="h-9 sm:h-10"
                >
                  <Lock className="mr-2 h-4 w-4" />
                  {t('settingsPanels.account.changePassword')}
                </Button>
              ) : (
                <div className="space-y-3 sm:space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="current-password" className="text-xs sm:text-sm">{t('settingsPanels.account.currentPassword')}</Label>
                    <Input
                      id="current-password"
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder={t('settingsPanels.account.currentPasswordPlaceholder')}
                      className="h-9 sm:h-10 md:text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-password" className="text-xs sm:text-sm">{t('settingsPanels.account.newPassword')}</Label>
                    <Input
                      id="new-password"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder={t('settingsPanels.account.newPasswordPlaceholder')}
                      className="h-9 sm:h-10 md:text-sm"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={handleChangePassword}
                      disabled={changePasswordMutation.isPending || !currentPassword || !newPassword}
                      className="h-9 sm:h-10"
                    >
                      {changePasswordMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Lock className="mr-2 h-4 w-4" />
                      )}
                      {t('settingsPanels.account.changePassword')}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setShowChangePassword(false)}
                      className="h-9 sm:h-10"
                    >
                      {t('settingsPanels.account.cancel')}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 @min-[1000px]:col-span-2">
          <Card className="border-0 shadow-none">
            <CardHeader className="pb-2 sm:pb-4">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <KeyRound className="h-4 w-4 sm:h-5 sm:w-5" />
                {t('settingsPanels.account.passkeys')}
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">{t('settingsPanels.account.passkeysDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 sm:space-y-4">
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  placeholder={t('settingsPanels.account.passkeyNamePlaceholder')}
                  value={passkeyName}
                  onChange={(e) => setPasskeyName(e.target.value)}
                  className="h-9 sm:h-10 md:text-sm"
                />
                <Button
                  onClick={handleAddPasskey}
                  disabled={addPasskeyMutation.isPending}
                  className="h-9 sm:h-10 whitespace-nowrap"
                >
                  {addPasskeyMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  {t('settingsPanels.account.addPasskey')}
                </Button>
              </div>

              {passkeysLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : passkeys && passkeys.length > 0 ? (
                <div className="space-y-2">
                  {passkeys.map((pk) => (
                    <div
                      key={pk.id}
                      className="flex items-center justify-between p-2.5 sm:p-3 bg-muted rounded-lg"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{pk.name || t('settingsPanels.account.unnamedPasskey')}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {pk.deviceType} - {new Date(pk.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 ml-2 flex-shrink-0"
                        onClick={() => handleDeletePasskey(pk.id)}
                        disabled={deletePasskeyMutation.isPending}
                      >
                        {deletePasskeyMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4 text-destructive" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs sm:text-sm text-muted-foreground text-center py-3">
                  {t('settingsPanels.account.noPasskeys')}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <LogOut className="h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-destructive">{t('settingsPanels.account.signOut')}</p>
            <p className="text-xs text-muted-foreground">{t('settingsPanels.account.signOutDescription')}</p>
          </div>
        </div>
        <Button variant="destructive" onClick={logout} className="h-9 shrink-0 sm:h-10">
          <LogOut className="mr-2 h-4 w-4" />
          {t('settingsPanels.account.signOut')}
        </Button>
      </div>

      <DeleteDialog
        open={deletePasskeyId !== null}
        onOpenChange={(open) => !open && setDeletePasskeyId(null)}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
        title={t('settingsPanels.account.deletePasskeyTitle')}
        description={t('settingsPanels.account.deletePasskeyDescription')}
        isDeleting={deletePasskeyMutation.isPending}
      />
    </div>
  )
}
