import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi } from '@/api/settings'
import { showToast } from '@/lib/toast'
import { refreshOpenCodeServerCaches } from '@/lib/queryInvalidation'
import { getOpenCodeApiErrorMessage } from '@/lib/opencode-errors'
import { useI18n } from '@/lib/i18n'

const RESTART_TOAST_ID = 'opencode-restart'
const UPGRADE_TOAST_ID = 'upgrade-opencode'

export function useOpenCodeServerActions() {
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [activeSessionCount, setActiveSessionCount] = useState(0)

  const restartServerMutation = useMutation({
    mutationFn: async () => settingsApi.restartOpenCodeServer(),
    onSuccess: () => {
      refreshOpenCodeServerCaches(queryClient)
    },
  })

  const upgradeOpenCodeMutation = useMutation({
    mutationFn: async () => settingsApi.upgradeOpenCode(),
    onSuccess: (data) => {
      refreshOpenCodeServerCaches(queryClient, data.upgraded ? data.newVersion ?? undefined : undefined)
      if (data.upgraded) {
        showToast.success(`Upgraded to v${data.newVersion} and server restarted`, { id: UPGRADE_TOAST_ID })
      } else {
        showToast.success(t('settingsPanels.server.upToDate'), { id: UPGRADE_TOAST_ID })
      }
    },
    onError: (error) => {
      const defaultMessage = 'Failed to upgrade OpenCode'

      if (error && typeof error === 'object' && 'response' in error) {
        const response = (error as { response?: { data?: { recovered?: boolean; recoveryMessage?: string; newVersion?: string } } }).response
        const data = response?.data

        if (data?.recovered && data.newVersion) {
          refreshOpenCodeServerCaches(queryClient, data.newVersion)
          showToast.success(`Upgrade failed but server recovered at v${data.newVersion}`, { id: UPGRADE_TOAST_ID })
        } else {
          refreshOpenCodeServerCaches(queryClient)
          showToast.error(data?.recoveryMessage || defaultMessage, { id: UPGRADE_TOAST_ID })
        }
      } else {
        refreshOpenCodeServerCaches(queryClient)
        showToast.error(defaultMessage, { id: UPGRADE_TOAST_ID })
      }
    },
  })

  const performRestart = async () => {
    showToast.loading('Restarting OpenCode server...', { id: RESTART_TOAST_ID })
    try {
      await restartServerMutation.mutateAsync()
      showToast.success(t('settingsPanels.server.restartSucceeded'), { id: RESTART_TOAST_ID })
    } catch (error) {
      showToast.error(getOpenCodeApiErrorMessage(error, 'Failed to restart OpenCode server'), { id: RESTART_TOAST_ID })
    }
  }

  const requestRestart = async () => {
    try {
      const { count } = await settingsApi.getActiveOpenCodeSessions()
      if (count > 0) {
        setActiveSessionCount(count)
        setConfirmOpen(true)
        return
      }
    } catch {
    void 0
    }
    await performRestart()
  }

  const confirmRestart = async () => {
    await performRestart()
    setConfirmOpen(false)
  }

  const performUpgrade = async () => {
    showToast.loading('Upgrading OpenCode...', { id: UPGRADE_TOAST_ID })
    try {
      await upgradeOpenCodeMutation.mutateAsync()
    } catch (error) {
      showToast.error(getOpenCodeApiErrorMessage(error, 'Failed to upgrade OpenCode'), { id: UPGRADE_TOAST_ID })
    }
  }

  return {
    restartServerMutation,
    upgradeOpenCodeMutation,
    confirmOpen,
    setConfirmOpen,
    activeSessionCount,
    requestRestart,
    confirmRestart,
    performUpgrade,
  }
}
