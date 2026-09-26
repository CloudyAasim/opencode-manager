import { FileBrowser } from '@/components/file-browser/FileBrowser'
import { Header } from '@/components/ui/header'
import { useI18n } from '@/lib/i18n'

export function Files() {
  const { t } = useI18n()

  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-background flex flex-col pb-[calc(env(safe-area-inset-bottom)+56px)] sm:pb-0">
      <Header>
        <Header.Title>{t('navigation.files')}</Header.Title>
      </Header>
      <div className="flex-1 min-h-0">
        <FileBrowser basePath="." embedded={true} />
      </div>
    </div>
  )
}
