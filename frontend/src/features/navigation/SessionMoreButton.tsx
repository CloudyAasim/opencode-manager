import { MoreVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMobileSheets } from '@/hooks/useMobileSheets'
import { useI18n } from '@/lib/i18n'

/**
 * Opens the *project* drawer, not the global one.
 *
 * This button sits on a session page next to the repository, so "more" here
 * means more about this session - MCP, Skills, Source Control, Schedules,
 * Reset Permissions. It used to open the same sheet as the top bar's
 * hamburger, which answered both questions at once and put five rows of project
 * furniture inside the app's global navigation menu.
 */
export function SessionMoreButton() {
  const { open } = useMobileSheets()
  const { t } = useI18n()

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => open('project')}
      className="md:hidden h-10 w-10 p-0 text-foreground border-border hover:bg-accent"
      aria-label={t('navigation.projectMore')}
    >
      <MoreVertical className="w-5 h-5" />
    </Button>
  )
}
