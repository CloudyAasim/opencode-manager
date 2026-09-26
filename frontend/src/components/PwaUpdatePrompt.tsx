import { useEffect } from 'react'
import { showToast } from '@/lib/toast'
import { onServiceWorkerUpdate, offServiceWorkerUpdate } from '@/lib/serviceWorker'
import { useI18n } from '@/lib/i18n'

export function PwaUpdatePrompt() {
  const { t } = useI18n()
  useEffect(() => {
    onServiceWorkerUpdate(() => {
      showToast.info(t('misc.pwa.newBuildDeployed'), {
        description: t('misc.pwa.refreshDescription'),
        action: {
          label: t('misc.pwa.refresh'),
          onClick: () => window.location.reload(),
        },
        duration: Infinity,
      })
    })
    return () => offServiceWorkerUpdate()
  }, [t])

  return null
}
