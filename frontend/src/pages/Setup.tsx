import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useLoaderData } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useI18n } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { UserPlus, ShieldAlert } from 'lucide-react'
import type { AuthConfig } from '@/lib/auth-loaders'
import { AuthShell, AuthCard, AuthError, AuthField, AuthSubmit } from '@/framework/shell/AuthShell'

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
    <AuthShell>
      {!config.registrationEnabled ? (
        <AuthCard>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            <h1 className="text-base font-semibold">{t('setup.disabledTitle')}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{t('setup.disabledDescription')}</p>
          <Button asChild className="w-full">
            <Link to="/login">{t('setup.goToSignIn')}</Link>
          </Button>
        </AuthCard>
      ) : (
        <AuthCard>
          <p className="text-center text-sm text-muted-foreground">{t('register.firstUserSubtitle')}</p>

          <AuthError message={error} />

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <AuthField id="name" label={t('register.name')} error={errors.name?.message}>
              <Input
                id="name"
                type="text"
                placeholder={t('register.namePlaceholder')}
                className="bg-input border-border focus:border-primary"
                {...register('name')}
                aria-invalid={!!errors.name}
              />
            </AuthField>
            <AuthField id="email" label={t('auth.email')} error={errors.email?.message}>
              <Input
                id="email"
                type="email"
                placeholder="admin@example.com"
                className="bg-input border-border focus:border-primary"
                {...register('email')}
                aria-invalid={!!errors.email}
              />
            </AuthField>
            <AuthField id="password" label={t('auth.password')} error={errors.password?.message}>
              <Input
                id="password"
                type="password"
                placeholder={t('register.passwordPlaceholder')}
                className="bg-input border-border focus:border-primary"
                {...register('password')}
                aria-invalid={!!errors.password}
              />
            </AuthField>
            <AuthSubmit
              busy={isSubmitting}
              busyLabel={t('register.createAdminAccount')}
              idleLabel={t('register.createAdminAccount')}
              idleIcon={<UserPlus className="h-4 w-4" />}
            />
          </form>
        </AuthCard>
      )}
    </AuthShell>
  )
}
