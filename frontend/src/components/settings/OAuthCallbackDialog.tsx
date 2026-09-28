import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, ExternalLink, CheckCircle } from 'lucide-react'
import { CopyButton } from '@/components/ui/copy-button'
import { showToast } from '@/lib/toast'
import { oauthApi, type OAuthAuthorizeResponse } from '@/api/oauth'
import { mapOAuthError } from '@/lib/oauthErrors'
import { useI18n } from '@/lib/i18n'

interface OAuthCallbackDialogProps {
  providerId: string
  providerName: string
  authResponse: OAuthAuthorizeResponse
  methodIndex: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function OAuthCallbackDialog({ 
  providerId, 
  providerName, 
  authResponse,
  methodIndex,
  open, 
  onOpenChange, 
  onSuccess 
}: OAuthCallbackDialogProps) {
  const { t } = useI18n()
  const [isLoading, setIsLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleCallback = async () => {
    setIsLoading(true)
    setLoadingMessage(t('settingsPanels.oauthCallback.completingAuth'))
    setError(null)

    try {
      setLoadingMessage(t('settingsPanels.oauthCallback.restartingServer'))
      await oauthApi.callback(
        providerId, 
        authResponse.method === 'code' 
          ? { method: methodIndex, code: authCode.trim() }
          : { method: methodIndex }
      )
      onSuccess()
    } catch (err) {
      setError(mapOAuthError(err, 'callback'))
    } finally {
      setIsLoading(false)
      setLoadingMessage('')
    }
  }

  const handleOpenAuthUrl = () => {
    window.open(authResponse.url, '_blank')
  }

  const handleClose = () => {
    setError(null)
    setAuthCode('')
    onOpenChange(false)
  }

  const isAutoMethod = authResponse.method === 'auto'

  // Extract device/user code from instructions (e.g., "Enter code: 596A-E304")
  const codeMatch = authResponse.instructions.match(/(?:Enter code|User code|Device code)[:\s]+([A-Z0-9-]+)/i)
  const deviceCode = codeMatch ? codeMatch[1] : ''

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('settingsPanels.oauthCallback.title', { name: providerName })}</DialogTitle>
          <DialogDescription>
            {isAutoMethod 
              ? t('settingsPanels.oauthCallback.autoDescription')
              : t('settingsPanels.oauthCallback.codeDescription')
            }
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-3">
            <div className="bg-muted p-3 rounded-md">
              <p className="text-sm mb-2">{authResponse.instructions}</p>
              
              {deviceCode && (
                <div className="flex items-center gap-2 mb-3">
                  <code className="flex-1 bg-background px-3 py-2 rounded text-sm font-mono">
                    {deviceCode}
                  </code>
                  <CopyButton
                    content={deviceCode}
                    title={t('settingsPanels.oauthCallback.copyDeviceCode')}
                    variant="ghost"
                    iconSize="sm"
                    className="flex-shrink-0"
                    onCopy={() => showToast.success(t('settingsPanels.oauthCallback.codeCopied'))}
                  />
                </div>
              )}
              
              <div className="flex gap-2">
                <Button
                  onClick={handleOpenAuthUrl}
                  variant="outline"
                  size="sm"
                  className="flex-1"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {t('settingsPanels.oauthCallback.openAuthPage')}
                </Button>
                <CopyButton
                  content={authResponse.url}
                  title={t('settingsPanels.oauthCallback.copyAuthUrl')}
                  variant="ghost"
                  iconSize="sm"
                  className="flex-shrink-0"
                  onCopy={() => showToast.success(t('settingsPanels.oauthCallback.urlCopied'))}
                />
              </div>
            </div>

            {!isAutoMethod && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="authCode">{t('settingsPanels.oauthCallback.authCode')}</Label>
                  <CopyButton
                    content={authCode}
                    title={t('settingsPanels.oauthCallback.copyAuthCode')}
                    variant="ghost"
                    iconSize="sm"
                    className="flex-shrink-0"
                    onCopy={() => showToast.success(t('settingsPanels.oauthCallback.codeCopied'))}
                  />
                </div>
                <Input
                  id="authCode"
                  value={authCode}
                  onChange={(e) => setAuthCode(e.target.value)}
                  placeholder={t('settingsPanels.oauthCallback.authCodePlaceholder')}
                  className="bg-background border-border"
                  disabled={isLoading}
                />
              </div>
            )}

            <Button
              onClick={handleCallback}
              className="w-full"
              disabled={isLoading || (!isAutoMethod && !authCode.trim())}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {loadingMessage || t('settingsPanels.oauthCallback.completing')}
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  {t('settingsPanels.oauthCallback.completeAuth')}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
