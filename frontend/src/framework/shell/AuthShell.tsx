import type { ComponentProps, ReactNode } from 'react'
import { LanguageToggle } from '@/components/LanguageToggle'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useI18n } from '@/lib/i18n'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AuthShellProps {
  subtitle?: ReactNode
  footer?: ReactNode
  children: ReactNode
}

export function AuthShell({ subtitle, footer, children }: AuthShellProps) {
  const { t } = useI18n()
  return (
    <div className="relative flex h-full min-h-0 flex-col items-center justify-center bg-background p-4">
      <LanguageToggle className="absolute right-4 top-4" />
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center space-y-2">
          <span className="text-2xl font-semibold tracking-tight text-foreground">
            {t('home.appName')}
          </span>
          {subtitle}
        </div>
        {children}
        {footer}
      </div>
    </div>
  )
}

export function AuthCard({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-border bg-card p-6 space-y-4">{children}</div>
}

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

interface AuthFieldProps {
  id: string
  label: string
  error?: string
  children: ReactNode
}

// The auth inputs restyle the shared Input: input-coloured surface,
// a border that matches the rest of the form, and a focus ring that also
// shows on mouse focus rather than keyboard focus only. All three pages
// spelled that out on every field, which is how the three of them drifted
// apart in the first place.
const AUTH_INPUT_CLASS = 'bg-input border-border focus:border-primary'

export function AuthInput({ className, ...props }: ComponentProps<typeof Input>) {
  return <Input className={cn(AUTH_INPUT_CLASS, className)} {...props} />
}

export function AuthField({ id, label, error, children }: AuthFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm text-muted-foreground">
        {label}
      </Label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

interface AuthSubmitProps {
  busy: boolean
  busyLabel: string
  idleLabel: string
  idleIcon: ReactNode
  disabled?: boolean
  children?: ReactNode
}

export function AuthSubmit({
  busy,
  busyLabel,
  idleLabel,
  idleIcon,
  disabled,
  children,
}: AuthSubmitProps) {
  return (
    <Button type="submit" className="w-full" disabled={disabled || busy}>
      {busy ? (
        <>
          <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {busyLabel}
        </>
      ) : (
        <>
          <span className="mr-2 flex h-4 w-4 items-center justify-center">{idleIcon}</span>
          {idleLabel}
        </>
      )}
      {children}
    </Button>
  )
}
