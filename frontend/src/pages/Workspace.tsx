import { FileBrowser } from '@/components/file-browser/FileBrowser'
import { Header } from '@/components/ui/header'
import { useI18n } from '@/lib/i18n'

export function Workspace() {
  const { t } = useI18n()
  return (
    <div className="h-screen bg-background flex flex-col">
      <Header>
        <Header.BackButton to="/repos" />
        <Header.Title>{t('session.workspace.title')}</Header.Title>
      </Header>

      <div className="flex-1 overflow-hidden p-4">
        <FileBrowser />
      </div>
    </div>
  )
}