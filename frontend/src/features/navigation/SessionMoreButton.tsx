import { MoreVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMobileSheets } from '@/hooks/useMobileSheets'
import { useI18n } from '@/lib/i18n'

export function SessionMoreButton() {
  const { open } = useMobileSheets()
  const { t } = useI18n()

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => open('more')}
      className="md:hidden h-10 w-10 p-0 text-foreground border-border hover:bg-accent"
      aria-label={t('navigation.more')}
    >
      <MoreVertical className="w-5 h-5" />
    </Button>
  )
}
