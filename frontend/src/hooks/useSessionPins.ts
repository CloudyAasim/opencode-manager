import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listSessionPins, toggleSessionPin } from '@/api/sessionPins'
import { showErrorToast } from '@/lib/error-toast'
import { stopQueries } from '@/lib/queryInvalidation'
import { useI18n } from '@/lib/i18n'
import { withToggledPin } from '@/lib/sessionPins'
import type { SessionPin, ToggleSessionPinRequest } from '@opencode-manager/shared/schemas'

export const SESSION_PINS_QUERY_KEY = ['session-pins'] as const

export function useSessionPins() {
  return useQuery({
    queryKey: SESSION_PINS_QUERY_KEY,
    queryFn: listSessionPins,
    staleTime: 30000,
  })
}

export function useToggleSessionPin() {
  const queryClient = useQueryClient()
  const { t } = useI18n()
  return useMutation({
    mutationFn: (input: ToggleSessionPinRequest) => toggleSessionPin(input),
    onMutate: async (input) => {
      // a refetch landing here would put the row back where it was
      await stopQueries(queryClient, { queryKey: SESSION_PINS_QUERY_KEY })
      const previous = queryClient.getQueryData<SessionPin[]>(SESSION_PINS_QUERY_KEY)
      if (previous) {
        queryClient.setQueryData(
          SESSION_PINS_QUERY_KEY,
          withToggledPin(previous, input, Date.now()),
        )
      }
      return { previous }
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(SESSION_PINS_QUERY_KEY, context.previous)
      showErrorToast(error, t('session.card.pinFailed'))
    },
    onSuccess: (pins: SessionPin[]) => {
      queryClient.setQueryData(SESSION_PINS_QUERY_KEY, pins)
    },
  })
}
