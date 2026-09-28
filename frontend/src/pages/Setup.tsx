import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useLoaderData } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useI18n } from '@/lib/i18n'
import { LanguageToggle } from '@/components/LanguageToggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, UserPlus, AlertCircle, ShieldAlert } from 'lucide-react'
import type { AuthConfig } from '@/lib/auth-loaders'

type SetupFormData = z.infer<ReturnType<typeof createSetupSchema>>

function createSetupSchema(nameMin: string, emailInvalid: string, passwordMin: string) {
  return z.object({
    name: z.string().min(2, nameMin),
    email: z.string().email(emailInvalid),
    password: z.string().min(8, passwordMin),
  })
}

export function Setup() {
  const { signUpWithEmail } = useAuth()
  const { config } = useLoaderData() as { config: AuthConfig }
  const { t } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const setupSchema = useMemo(
    () => createSetupSchema(t('register.nameMin'), t('auth.emailInvalid'), t('register.passwordMin')),
    [t],
  )

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SetupFormData>({
    resolver: zodResolver(setupSchema),
  })

  const onSubmit = async (data: SetupFormData) => {
    setError(null)
    setIsSubmitting(true)
    try {
      const result = await signUpWithEmail(data.email, data.password, data.name)
      if (result.error) {
        setError(result.error)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="relative h-dvh flex flex-col items-center justify-center bg-background p-4">
      <LanguageToggle className="absolute right-4 top-4" />
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center space-y-2">
          <span className="text-2xl font-semibold tracking-tight text-foreground">{t('home.appName')}</span>
        </div>

        {!config.registrationEnabled ? (
          <div className="rounded-lg border border-border bg-card p-6 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-500" />
              <h1 className="text-base font-semibold">{t('setup.disabledTitle')}</h1>
            </div>
            <p className="text-sm text-muted-foreground">{t('setup.disabledDescription')}</p>
            <Button asChild className="w-full">
              <Link to="/login">{t('setup.goToSignIn')}</Link>
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-6 space-y-4">
            <p className="text-center text-sm text-muted-foreground">{t('register.firstUserSubtitle')}</p>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm text-muted-foreground">{t('register.name')}</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder={t('register.namePlaceholder')}
                  className="bg-input border-border focus:border-primary"
                  {...register('name')}
                  aria-invalid={!!errors.name}
                />
                {errors.name && (
                  <p className="text-sm text-destructive">{errors.name.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm text-muted-foreground">{t('auth.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@example.com"
                  className="bg-input border-border focus:border-primary"
                  {...register('email')}
                  aria-invalid={!!errors.email}
                />
                {errors.email && (
                  <p className="text-sm text-destructive">{errors.email.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm text-muted-foreground">{t('auth.password')}</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder={t('register.passwordPlaceholder')}
                  className="bg-input border-border focus:border-primary"
                  {...register('password')}
                  aria-invalid={!!errors.password}
                />
                {errors.password && (
                  <p className="text-sm text-destructive">{errors.password.message}</p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <UserPlus className="mr-2 h-4 w-4" />
                )}
                {t('register.createAdminAccount')}
              </Button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
