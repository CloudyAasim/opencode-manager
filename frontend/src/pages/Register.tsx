import { useMemo, useState } from 'react'
import { Link, useLoaderData } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { useI18n } from '@/lib/i18n'
import { LanguageToggle } from '@/components/LanguageToggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, UserPlus, AlertCircle } from 'lucide-react'
import type { AuthConfig } from '@/lib/auth-loaders'

type RegisterFormData = z.infer<ReturnType<typeof createRegisterSchema>>

function createRegisterSchema(nameMin: string, emailInvalid: string, passwordMin: string, mismatch: string) {
  return z.object({
    name: z.string().min(2, nameMin),
    email: z.string().email(emailInvalid),
    password: z.string().min(8, passwordMin),
    confirmPassword: z.string(),
  }).refine((data) => data.password === data.confirmPassword, {
    message: mismatch,
    path: ['confirmPassword'],
  })
}

export function Register() {
  const { signUpWithEmail } = useAuth()
  const { config } = useLoaderData() as { config: AuthConfig }
  const theme = useTheme()
  const { t, locale } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const registerSchema = useMemo(
    () => createRegisterSchema(
      t('register.nameMin'),
      t('auth.emailInvalid'),
      t('register.passwordMin'),
      t('register.passwordsDoNotMatch'),
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, t],
  )

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  })

  const onSubmit = async (data: RegisterFormData) => {
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
    <div className="relative h-dvh flex flex-col items-center justify-center bg-gradient-to-br from-background via-background to-background p-4">
      <LanguageToggle className="absolute right-4 top-4" />
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center space-y-2">
          <img 
            src={theme === 'light' ? "/opencode-wordmark-light.svg" : "/opencode-wordmark-dark.svg"} 
            alt="OpenCode" 
            className="h-8 w-auto"
          />
          <p className="text-sm text-muted-foreground">
            {config.isFirstUser
              ? t('register.firstUserSubtitle')
              : t('register.subtitle')}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
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
                placeholder={t('register.emailPlaceholder')}
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
            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-sm text-muted-foreground">{t('register.confirmPassword')}</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder={t('register.confirmPasswordPlaceholder')}
                className="bg-input border-border focus:border-primary"
                {...register('confirmPassword')}
                aria-invalid={!!errors.confirmPassword}
              />
              {errors.confirmPassword && (
                <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="mr-2 h-4 w-4" />
              )}
              {config.isFirstUser ? t('register.createAdminAccount') : t('register.createAccount')}
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          {t('register.alreadyHaveAccount')}{' '}
          <Link to="/login" className="text-primary hover:underline transition-colors">
            {t('register.signIn')}
          </Link>
        </p>
      </div>
    </div>
  )
}
