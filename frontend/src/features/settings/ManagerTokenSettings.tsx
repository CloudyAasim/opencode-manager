import { useState } from 'react'
import { useManagerToken } from '@/hooks/useManagerToken'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle, Check, Copy, Eye, EyeOff, RefreshCw } from 'lucide-react'
import { SettingsDisclosure } from './SettingsDisclosure'
import { useI18n } from '@/lib/i18n'
import { showErrorToast } from '@/lib/error-toast'
import { showToast } from '@/lib/toast'
import { useCancellableTimer } from '@/hooks/use-cancellable-timer'

interface ManagerTokenSettingsProps {
  isOpen?: boolean
  onToggle?: () => void
}

export function ManagerTokenSettings({ isOpen: controlledOpen, onToggle }: ManagerTokenSettingsProps = {}) {
  const { t } = useI18n()
  const { token, isLoading, rotate } = useManagerToken()
  const [showToken, setShowToken] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(true)
  const { schedule } = useCancellableTimer()
  const isOpen = controlledOpen ?? uncontrolledOpen
  const handleToggle = onToggle ?? (() => setUncontrolledOpen((open) => !open))

  const handleCopy = async () => {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      schedule('copied', () => setCopied(false), 2000)
    } catch (error) {
      showErrorToast(error, t('settingsPanels.managerToken.copyFailed'))
    }
  }

  const handleRotate = () => {
    if (!confirmRotate) {
      setConfirmRotate(true)
      schedule('rotate', () => setConfirmRotate(false), 4000)
      return
    }
    rotate.mutate(undefined, {
      onSuccess: () => showToast.success(t('settingsPanels.managerToken.rotateSucceeded')),
      onError: (error) => showErrorToast(error, t('settingsPanels.managerToken.rotateFailed')),
    })
    setConfirmRotate(false)
  }

  return (
    <SettingsDisclosure
      title={t('settingsPanels.managerToken.title')}
      isOpen={isOpen}
      onToggle={handleToggle}
      contentClassName="space-y-3"
      meta={
        <span className="text-xs text-muted-foreground truncate hidden sm:inline">
          {t('settingsPanels.managerToken.meta')}
        </span>
      }
    >
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            id="manager-token"
            type={showToken ? 'text' : 'password'}
            value={isLoading ? t('settingsPanels.managerToken.loading') : token ?? ''}
            readOnly
            className="flex-1 font-mono pr-9"
            autoComplete="new-password"
            name="manager-token-input"
          />
          <button
            type="button"
            onClick={() => setShowToken(!showToken)}
            disabled={!token}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <Button
          variant="outline"
          size="icon"
          type="button"
          onClick={handleCopy}
          disabled={!token}
          aria-label={t('settingsPanels.managerToken.copy')}
          title={t('settingsPanels.managerToken.copy')}
        >
          {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
        </Button>
        <Button
          variant={confirmRotate ? 'destructive' : 'outline'}
          size="icon"
          type="button"
          onClick={handleRotate}
          disabled={rotate.isPending || isLoading}
          aria-label={t('settingsPanels.managerToken.rotate')}
          title={t('settingsPanels.managerToken.rotate')}
        >
          <RefreshCw className={`size-4 ${rotate.isPending ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {t('settingsPanels.managerToken.personalNote')}
      </p>

      {confirmRotate && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertDescription>
            {t('settingsPanels.managerToken.rotateWarning')}
          </AlertDescription>
        </Alert>
      )}
    </SettingsDisclosure>
  )
}
