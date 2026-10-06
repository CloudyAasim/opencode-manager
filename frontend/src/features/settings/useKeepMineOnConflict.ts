import { useMutation, useQueryClient } from '@tanstack/react-query'
import { providerDeclarationsApi } from '@/api/providerDeclarations'
import { showErrorToast } from '@/lib/error-toast'
import { showToast } from '@/lib/toast'
import { useI18n } from '@/lib/i18n'

export const PROVIDER_DECLARATIONS_QUERY_KEY = ['provider-declarations'] as const

/**
 * Records "keep mine" and re-reads the declarations.
 *
 * Its own file, and a hook rather than a component, for two reasons that both
 * come from the same rule about what a module may export: this one is about the
 * request rather than the markup, and a component file that also exports
 * functions breaks fast refresh for everything on screen.
 */
export function useKeepMineOnConflict() {
  const { t } = useI18n()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: (providerId: string) => providerDeclarationsApi.keepMine(providerId),
    onSuccess: (_result, providerId) => {
      void queryClient.invalidateQueries({ queryKey: PROVIDER_DECLARATIONS_QUERY_KEY })
      showToast.success(t('settingsPanels.provider.conflictKeptMine', { id: providerId }))
    },
    // A refused acknowledgement must not look like an accepted one. The notice
    // stays exactly as it was, because nothing was decided.
    onError: (error) => showErrorToast(error, t('settingsPanels.provider.conflictKeepMineFailed')),
  })

  return { keepMine: mutation.mutate, isPending: mutation.isPending }
}
