import { useEffect, useRef } from 'react'
import { showToast } from '@/lib/toast'
import { useVersionCheck } from '@/hooks/useVersionCheck'
import { useI18n } from '@/lib/i18n'

export function VersionNotifier() {
  const { data, isSuccess } = useVersionCheck()
  const { t } = useI18n()
  const hasNotifiedRef = useRef(false)

  useEffect(() => {
    if (!isSuccess || !data || hasNotifiedRef.current) return

    if (data.updateAvailable && data.latestVersion && data.releaseUrl) {
      hasNotifiedRef.current = true
      showToast.info(t('misc.version.updateAvailable', { version: data.latestVersion }), {
        description: t('misc.version.newVersionReady'),
        action: {
          label: t('misc.version.viewRelease'),
          onClick: () => window.open(data.releaseUrl ?? '', '_blank'),
        },
        duration: 10000,
      })
    }
  }, [isSuccess, data, t])

  return null
}
