import { LOCALE_LABELS, SUPPORTED_LOCALES, useI18n, type SupportedLocale } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface LanguageToggleProps {
  className?: string
}

export function LanguageToggle({ className }: LanguageToggleProps) {
  const { locale, setLocale } = useI18n()

  return (
    <div className={cn('inline-flex items-center rounded-md border border-border bg-card p-0.5 text-xs', className)}>
      {SUPPORTED_LOCALES.map((supported: SupportedLocale) => (
        <Button
          key={supported}
          type="button"
          variant={locale === supported ? 'selected' : 'ghost'}
          size="xs"
          onClick={() => setLocale(supported)}
          aria-pressed={locale === supported}
          className="px-2"
        >
          {LOCALE_LABELS[supported]}
        </Button>
      ))}
    </div>
  )
}
