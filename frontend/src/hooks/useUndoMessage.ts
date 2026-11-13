import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createBffClient } from '@/api/bff'
import { showToast } from '@/lib/toast'
import { useI18n } from '@/lib/i18n'
import { messagesQueryKey, sessionQueryKey, stopQueries } from '@/lib/queryInvalidation'
import type { MessageWithParts } from '@/api/types'

interface UseUndoMessageOptions {
  serverUrl: string | null
  sessionId: string
  directory?: string
  onSuccess?: (restoredPrompt: string) => void
}

interface UndoMessageContext {
  previousMessages?: MessageWithParts[]
}

/**
 * Take the last answer back, and say the question again.
 *
 * The layer is asked, not the agent: it knows where the conversation lives,
 * and it is the one that decides whether the caller may have it.
 */
export function useUndoMessage({ 
  serverUrl, 
  sessionId, 
  directory,
  onSuccess 
}: UseUndoMessageOptions) {
  const queryClient = useQueryClient()
  const { t } = useI18n()

  return useMutation<string, Error, { messageID: string; messageContent: string }, UndoMessageContext>({
    mutationFn: async ({ messageID, messageContent }: { messageID: string, messageContent: string }) => {
      // An empty address is not a missing one: it means "the server that served
      // this page", which is what a deployment behind its own address looks
      // like from here.
      if (serverUrl === undefined || serverUrl === null) {
        throw new Error('The layer the client talks to is not available')
      }

      await createBffClient(serverUrl).revertSession(
        sessionId,
        { messageId: messageID, partId: null },
        directory ? [directory] : [],
      )
      return messageContent
    },
    onMutate: async ({ messageID }) => {
      const queryKey = messagesQueryKey(serverUrl, sessionId, directory)
      
      await stopQueries(queryClient, { queryKey })
      
      const previousMessages = queryClient.getQueryData<MessageWithParts[]>(queryKey)
      
      if (previousMessages) {
        const messageIndex = previousMessages.findIndex(m => m.info.id === messageID)
        if (messageIndex !== -1) {
          const newMessages = previousMessages.slice(0, messageIndex)
          queryClient.setQueryData(queryKey, newMessages)
        }
      }
      
      return { previousMessages }
    },
    onError: (_error, _variables, _context: UndoMessageContext | undefined) => {
      if (_context?.previousMessages) {
        queryClient.setQueryData(
          messagesQueryKey(serverUrl, sessionId, directory),
          _context.previousMessages
        )
      }
      
      showToast.error(t('message.errors.undoFailed'))
    },
    onSuccess: (restoredPrompt) => {
      queryClient.invalidateQueries({
        queryKey: messagesQueryKey(serverUrl, sessionId, directory)
      })
      queryClient.invalidateQueries({
        queryKey: sessionQueryKey(serverUrl, sessionId, directory)
      })
      onSuccess?.(restoredPrompt)
    }
  })
}
