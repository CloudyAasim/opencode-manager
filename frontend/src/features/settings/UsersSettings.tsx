import { useState } from 'react'
import { PanelLoading } from '@/components/ui/panel-loading'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle, KeyRound, Loader2, RefreshCw, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import { adminUsersApi, type ManagedUser, type UserRole } from '@/api/adminUsers'
import { FetchError } from '@/api/fetchWrapper'
import { useAuth } from '@/hooks/useAuth'
import { useI18n } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ConfirmDestructiveDialog } from '@/components/ui/confirm-destructive-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const KNOWN_ERROR_CODES = new Set([
  'EMAIL_EXISTS',
  'USER_NOT_FOUND',
  'LAST_ADMIN',
  'SELF_DELETE',
  'NO_CREDENTIAL_ACCOUNT',
  'CLEANUP_FAILED',
  'INTERNAL',
])

export function UsersSettings() {
  const { user } = useAuth()
  const { t } = useI18n()
  const queryClient = useQueryClient()

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('user')

  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null)
  const [resetPasswordValue, setResetPasswordValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null)

  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: adminUsersApi.list,
  })

  const errorMessage = (err: unknown): string => {
    const raw = err instanceof FetchError ? err.message : err instanceof Error ? err.message : 'UNKNOWN'
    if (KNOWN_ERROR_CODES.has(raw)) {
      return t(`settings.users.errors.${raw}`)
    }
    return raw || t('settings.users.errors.UNKNOWN')
  }

  const clearNotices = () => {
    setError(null)
    setSuccess(null)
  }

  const createMutation = useMutation({
    mutationFn: adminUsersApi.create,
    onSuccess: () => {
      clearNotices()
      setSuccess(t('settings.users.created'))
      setEmail('')
      setName('')
      setUsername('')
      setPassword('')
      setRole('user')
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: (err) => {
      setSuccess(null)
      setError(errorMessage(err))
    },
  })

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) => adminUsersApi.setRole(id, role),
    onSuccess: () => {
      clearNotices()
      setSuccess(t('settings.users.roleUpdated'))
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: (err) => {
      setSuccess(null)
      setError(errorMessage(err))
    },
  })

  const resetMutation = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => adminUsersApi.resetPassword(id, password),
    onSuccess: () => {
      clearNotices()
      setSuccess(t('settings.users.passwordReset'))
      setResetTarget(null)
      setResetPasswordValue('')
    },
    onError: (err) => {
      setSuccess(null)
      setError(errorMessage(err))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminUsersApi.remove(id),
    onSuccess: () => {
      clearNotices()
      setSuccess(t('settings.users.deleted'))
      setDeleteTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: (err) => {
      setSuccess(null)
      setError(errorMessage(err))
      setDeleteTarget(null)
    },
  })

  const users = usersQuery.data ?? []
  const isSubmitting = createMutation.isPending
  const canSubmit = email.trim().length > 0 && name.trim().length > 0 && password.length >= 8

  const handleCreate = () => {
    if (!canSubmit) return
    clearNotices()
    createMutation.mutate({ email: email.trim(), name: name.trim(), username: username.trim() || undefined, password, role })
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('settings.users.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('settings.users.description')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => usersQuery.refetch()} disabled={usersQuery.isFetching}>
          {usersQuery.isFetching ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {t('settings.users.refresh')}
        </Button>
      </div>

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

      <Card className="border-0 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <UserPlus className="h-4 w-4 sm:h-5 sm:w-5" />
            {t('settings.users.createUser')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5">
              <Label htmlFor="new-user-name" className="text-xs sm:text-sm">{t('settings.users.name')}</Label>
              <Input
                id="new-user-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('settings.users.namePlaceholder')}
                className="h-9 sm:h-10 md:text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-user-username" className="text-xs sm:text-sm">{t('settings.users.username')}</Label>
              <Input
                id="new-user-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t('settings.users.usernamePlaceholder')}
                className="h-9 sm:h-10 md:text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-user-email" className="text-xs sm:text-sm">{t('settings.users.email')}</Label>
              <Input
                id="new-user-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('settings.users.emailPlaceholder')}
                className="h-9 sm:h-10 md:text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-user-password" className="text-xs sm:text-sm">{t('settings.users.password')}</Label>
              <Input
                id="new-user-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('settings.users.passwordPlaceholder')}
                className="h-9 sm:h-10 md:text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-user-role" className="text-xs sm:text-sm">{t('settings.users.role')}</Label>
              <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
                <SelectTrigger id="new-user-role" className="h-9 sm:h-10 md:text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">{t('settings.users.roleUser')}</SelectItem>
                  <SelectItem value="admin">{t('settings.users.roleAdmin')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button onClick={handleCreate} disabled={!canSubmit || isSubmitting} className="h-9 sm:h-10">
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="mr-2 h-4 w-4" />
              )}
              {t('settings.users.create')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <ShieldCheck className="h-4 w-4 sm:h-5 sm:w-5" />
            {t('settings.users.memberCount', { count: users.length })}
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">{t('settings.users.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {usersQuery.isLoading ? (
            <PanelLoading className="py-6" size="sm" />
          ) : usersQuery.isError ? (
            <p className="py-3 text-center text-sm text-destructive">{t('settings.users.loadFailed')}</p>
          ) : users.length === 0 ? (
            <p className="py-3 text-center text-sm text-muted-foreground">{t('settings.users.empty')}</p>
          ) : (
            users.map((managedUser) => {
              const isSelf = managedUser.id === user?.id
              const rowBusy =
                (roleMutation.isPending && roleMutation.variables?.id === managedUser.id) ||
                (deleteMutation.isPending && deleteMutation.variables === managedUser.id)

              return (
                <div
                  key={managedUser.id}
                  className="flex flex-col gap-3 rounded-lg bg-muted p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{managedUser.name}</p>
                      {managedUser.role === 'admin' && (
                        <Badge variant="secondary" className="shrink-0">
                          {t('settings.users.roleAdmin')}
                        </Badge>
                      )}
                      {isSelf && (
                        <Badge variant="outline" className="shrink-0">
                          {t('settings.users.you')}
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {managedUser.username ? `@${managedUser.username} · ` : ''}{managedUser.email} · {new Date(managedUser.createdAt).toLocaleDateString()}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={managedUser.role}
                      onValueChange={(value) => roleMutation.mutate({ id: managedUser.id, role: value as UserRole })}
                      disabled={rowBusy}
                    >
                      <SelectTrigger className="h-8 w-36 text-xs" aria-label={t('settings.users.role')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">{t('settings.users.roleUser')}</SelectItem>
                        <SelectItem value="admin">{t('settings.users.roleAdmin')}</SelectItem>
                      </SelectContent>
                    </Select>

                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => {
                        clearNotices()
                        setResetTarget(managedUser)
                        setResetPasswordValue('')
                      }}
                      disabled={rowBusy}
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => {
                        clearNotices()
                        setDeleteTarget(managedUser)
                      }}
                      disabled={rowBusy || isSelf}
                      aria-label={t('settings.users.deleteUser')}
                    >
                      {deleteMutation.isPending && deleteMutation.variables === managedUser.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 text-destructive" />
                      )}
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      <Dialog open={resetTarget !== null} onOpenChange={(open) => !open && setResetTarget(null)}>
        <DialogContent className="max-w-[90%] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t('settings.users.resetPasswordTitle', { email: resetTarget?.email ?? '' })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reset-password" className="text-xs sm:text-sm">{t('settings.users.newPassword')}</Label>
            <Input
              id="reset-password"
              type="password"
              value={resetPasswordValue}
              onChange={(e) => setResetPasswordValue(e.target.value)}
              placeholder={t('settings.users.passwordPlaceholder')}
              className="h-9 sm:h-10 md:text-sm"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setResetTarget(null)} disabled={resetMutation.isPending}>
              {t('settings.users.cancel')}
            </Button>
            <Button
              onClick={() => {
                if (resetTarget && resetPasswordValue.length >= 8) {
                  resetMutation.mutate({ id: resetTarget.id, password: resetPasswordValue })
                }
              }}
              disabled={resetMutation.isPending || resetPasswordValue.length < 8}
            >
              {resetMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('settings.users.resetPassword')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDestructiveDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
        title={t('settings.users.deleteConfirmTitle')}
        description={t('settings.users.deleteConfirmDescription', { email: deleteTarget?.email ?? '' })}
        confirmLabel={t('settings.users.deleteUser')}
        cancelLabel={t('settings.users.cancel')}
        isPending={deleteMutation.isPending}
      />
    </div>
  )
}
