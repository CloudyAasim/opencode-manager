import { LOCALE_LABELS, SUPPORTED_LOCALES, useI18n, type SupportedLocale } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface LanguageToggleProps {
  className?: string
}

export function LanguageToggle({ className }: LanguageToggleProps) {
  const { locale, setLocale } = useI18n()

  return (
    <div className={cn('inline-flex items-center rounded-md border border-border bg-card p-0.5 text-xs', className)}>
      {SUPPORTED_LOCALES.map((supported: SupportedLocale) => (
        <button
          key={supported}
          type="button"
          onClick={() => setLocale(supported)}
          aria-pressed={locale === supported}
          className={cn(
            'rounded px-2 py-1 transition-colors',
            locale === supported
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {LOCALE_LABELS[supported]}
        </button>
      ))}
    </div>
  )
}
