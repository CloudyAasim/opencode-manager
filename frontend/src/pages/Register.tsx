import { useMemo, useState } from 'react'
import { Link, useLoaderData } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '@/hooks/useAuth'
import { useI18n } from '@/lib/i18n'
import { UserPlus } from 'lucide-react'
import type { AuthConfig } from '@/lib/auth-loaders'
import { AuthCard, AuthError, AuthField, AuthInput, AuthShell, AuthSubmit } from '@/framework/shell/AuthShell'

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
  const { t } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const registerSchema = useMemo(
    () => createRegisterSchema(
      t('register.nameMin'),
      t('auth.emailInvalid'),
      t('register.passwordMin'),
      t('register.passwordsDoNotMatch'),
    ),
    [t],
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
    <AuthShell
      subtitle={
        <p className="text-sm text-muted-foreground">
          {config.isFirstUser ? t('register.firstUserSubtitle') : t('register.subtitle')}
        </p>
      }
      footer={
        <p className="text-center text-sm text-muted-foreground">
          {t('register.alreadyHaveAccount')}{' '}
          <Link to="/login" className="text-primary hover:underline transition-colors">
            {t('register.signIn')}
          </Link>
        </p>
      }
    >
      <AuthCard>
        <AuthError message={error} />

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <AuthField id="name" label={t('register.name')} error={errors.name?.message}>
            <AuthInput
              id="name"
              type="text"
              placeholder={t('register.namePlaceholder')}
              {...register('name')}
              aria-invalid={!!errors.name}
            />
          </AuthField>
          <AuthField id="email" label={t('auth.email')} error={errors.email?.message}>
            <AuthInput
              id="email"
              type="email"
              placeholder={t('register.emailPlaceholder')}
              {...register('email')}
              aria-invalid={!!errors.email}
            />
          </AuthField>
          <AuthField id="password" label={t('auth.password')} error={errors.password?.message}>
            <AuthInput
              id="password"
              type="password"
              placeholder={t('register.passwordPlaceholder')}
              {...register('password')}
              aria-invalid={!!errors.password}
            />
          </AuthField>
          <AuthField
            id="confirmPassword"
            label={t('register.confirmPassword')}
            error={errors.confirmPassword?.message}
          >
            <AuthInput
              id="confirmPassword"
              type="password"
              placeholder={t('register.confirmPasswordPlaceholder')}
              {...register('confirmPassword')}
              aria-invalid={!!errors.confirmPassword}
            />
          </AuthField>
          <AuthSubmit
            busy={isSubmitting}
            busyLabel={t('register.createAdminAccount')}
            idleLabel={config.isFirstUser ? t('register.createAdminAccount') : t('register.createAccount')}
            idleIcon={<UserPlus className="h-4 w-4" />}
          />
        </form>
      </AuthCard>
    </AuthShell>
  )
}
