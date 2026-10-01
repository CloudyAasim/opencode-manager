import { useNavigate } from 'react-router-dom'
import { Header } from '@/components/ui/header'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'

export function NotFound() {
  const { t } = useI18n()
  const navigate = useNavigate()

  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-background flex flex-col">
      <Header>
        <Header.BackButton to="/" />
        <Header.Title>OpenCode Manager</Header.Title>
      </Header>

      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-4xl font-semibold text-foreground">404</p>
        <p className="text-base text-muted-foreground">{t('misc.common.pageNotFound')}</p>
        <Button onClick={() => navigate('/')}>{t('misc.common.backToHome')}</Button>
      </div>
    </div>
  )
}
