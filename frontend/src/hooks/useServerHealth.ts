import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { settingsApi } from '@/api/settings'
import { invalidateConfigCaches, invalidateSettingsCaches } from '@/lib/queryInvalidation'
import { fetchWrapper } from '@/api/fetchWrapper'
import { useSettingsDialog } from '@/hooks/useSettingsDialog'
import { useI18n } from '@/lib/i18n'

const MISSING_PASSWORD_ERROR_PATTERN = /no password is configured|OPENCODE_SERVER_PASSWORD/i

function isMissingPasswordError(error: string | undefined): boolean {
  return !!error && MISSING_PASSWORD_ERROR_PATTERN.test(error)
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy'
  timestamp: string
  database: 'connected' | 'disconnected'
  opencode: 'healthy' | 'unhealthy'
  opencodePort: number
  opencodeVersion: string | null
  opencodeMinVersion: string
  opencodeVersionSupported: boolean
  opencodeManagerVersion: string | null
  opencodeRestartPending?: boolean
  error?: string
}

async function fetchHealth(): Promise<HealthResponse> {
  return fetchWrapper<HealthResponse>('/api/health')
}

export function useServerHealth(enabled = true) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { isOpen: isSettingsOpen, setActiveTab } = useSettingsDialog()
  const lastHealthStatusRef = useRef<'healthy' | 'unhealthy'>('healthy')
  const prevHealthRef = useRef<string | null>(null)
  const hasAutoOpenedSettingsRef = useRef(false)

  const restartMutation = useMutation({
    mutationFn: async () => {
      return await settingsApi.reloadOpenCodeConfig()
    },
    onSuccess: () => {
      invalidateConfigCaches(queryClient)
      toast.success(t('session.actions.restartSucceeded'), { id: 'reload-config' })
    },
    onError: (error: unknown) => {
      const errorMessage = error && typeof error === 'object' && 'response' in error
        ? ((error as { response?: { data?: { details?: string; error?: string } } }).response?.data?.details
           || (error as { response?: { data?: { details?: string; error?: string } } }).response?.data?.error
           || 'Failed to restart OpenCode server')
        : 'Failed to restart OpenCode server'
      toast.error(errorMessage, { id: 'reload-config' })
    },
  })

  const rollbackMutation = useMutation({
    mutationFn: async () => {
      return await settingsApi.rollbackOpenCodeConfig()
    },
    onSuccess: (data) => {
      invalidateSettingsCaches(queryClient)
      toast.success(data.message, { id: 'rollback-config' })
    },
    onError: () => {
      toast.error(t('session.actions.rollbackFailed'), { id: 'rollback-config' })
    },
  })

  const query = useQuery<HealthResponse>({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 60000,
    retry: false,
    enabled,
    staleTime: 30000,
  })

  const { data: health } = query

  useEffect(() => {
    if (!health) return

    const isUnhealthy = health.opencode !== 'healthy'
    const currentStatus = isUnhealthy ? 'unhealthy' : 'healthy'
    const previousStatus = lastHealthStatusRef.current
    const prevHealth = prevHealthRef.current
    const missingPassword = isUnhealthy && isMissingPasswordError(health.error)

    if (isUnhealthy && missingPassword && !hasAutoOpenedSettingsRef.current && !isSettingsOpen) {
      hasAutoOpenedSettingsRef.current = true
      setActiveTab('opencode')
      toast.error(health.error || t('session.actions.healthPasswordRequired'), {
        id: 'server-health-password',
        duration: Infinity,
        description: t('session.actions.healthPasswordHint'),
      })
    } else if (prevHealth && currentStatus !== prevHealth) {
      if (isUnhealthy && previousStatus === 'healthy') {
        toast.error(health.error || t('session.actions.healthUnhealthy'), {
          id: 'server-health-unhealthy',
          duration: Infinity,
          action: {
            label: t('session.actions.restart'),
            onClick: () => restartMutation.mutate(),
          },
        })
      } else if (!isUnhealthy && previousStatus === 'unhealthy') {
        toast.success(t('session.actions.healthOnline'), { id: 'server-health-online' })
        hasAutoOpenedSettingsRef.current = false
      }
    }

    lastHealthStatusRef.current = currentStatus
    prevHealthRef.current = currentStatus
  }, [health, restartMutation, isSettingsOpen, setActiveTab, t])

  return {
    ...query,
    restartMutation,
    rollbackMutation,
  }
}
