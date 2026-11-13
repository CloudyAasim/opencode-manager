import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createBffClient } from '@/api/bff'
import { showToast } from '@/lib/toast'
import { useI18n } from '@/lib/i18n'
import { messagesQueryKey, sessionQueryKey, stopQueries } from '@/lib/queryInvalidation'
import type { Message, Part, MessageWithParts } from '@/api/types'

interface UseRemoveMessageOptions {
  serverUrl: string | null
  sessionId: string
  directory?: string
}

interface RemoveMessageContext {
  previousMessages?: MessageWithParts[]
}

/**
 * Take a message back.
 *
 * The layer is asked, not the agent: the layer knows where the conversation
 * lives, so the client does not have to say - and a conversation that is not
 * the caller's is refused the same way a conversation that does not exist is.
 */
export function useRemoveMessage({ serverUrl, sessionId, directory }: UseRemoveMessageOptions) {
  const queryClient = useQueryClient()
  const { t } = useI18n()

  return useMutation<unknown, Error, { messageID: string; partID?: string }, RemoveMessageContext>({
    mutationFn: async ({ messageID, partID }: { messageID: string, partID?: string }) => {
      // An empty address is not a missing one: it means "the server that served
      // this page", which is what a deployment behind its own address looks
      // like from here.
      if (serverUrl === undefined || serverUrl === null) {
        throw new Error('The layer the client talks to is not available')
      }

      const response = await createBffClient(serverUrl).revertSession(
        sessionId,
        { messageId: messageID, partId: partID ?? null },
        directory ? [directory] : [],
      )
      return response.session
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
    onError: (_error, _variables, _context: RemoveMessageContext | undefined) => {
      if (_context?.previousMessages) {
        queryClient.setQueryData(
          messagesQueryKey(serverUrl, sessionId, directory),
          _context.previousMessages
        )
      }

      showToast.error(t('message.errors.removeFailed'))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: messagesQueryKey(serverUrl, sessionId, directory)
      })
      queryClient.invalidateQueries({
        queryKey: sessionQueryKey(serverUrl, sessionId, directory)
      })
    }
  })
}

interface UseRefreshMessageOptions {
  serverUrl: string | null
  sessionId: string
  directory?: string
}

/**
 * Say it again, differently.
 *
 * The message is taken back and the words are said again - the layer is asked
 * for both, because the layer knows where the conversation lives.
 */
export function useRefreshMessage({ serverUrl, sessionId, directory }: UseRefreshMessageOptions) {
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const removeMessage = useRemoveMessage({ serverUrl, sessionId, directory })

  return useMutation({
    mutationFn: async ({
      assistantMessageID,
      userMessageContent,
      model,
      agent
    }: {
      assistantMessageID: string
      userMessageContent: string
      model?: string
      agent?: string
    }) => {
      if (serverUrl === undefined || serverUrl === null) {
        throw new Error('The layer the client talks to is not available')
      }

      await removeMessage.mutateAsync({ messageID: assistantMessageID })

      const optimisticUserID = `optimistic_user_${Date.now()}_${Math.random()}`
      const userMessageInfo: Message = {
        id: optimisticUserID,
        role: 'user',
        sessionId: sessionId,
        createdAt: Date.now(),
        completedAt: null,
        cost: null,
        tokens: null,
        modelId: null,
        providerId: null,
        agent: agent ?? null,
        variant: null,
        parentId: null,
        error: null,
      }

      const userMessageParts: Part[] = [{
        id: `${optimisticUserID}_part_0`,
        type: 'text',
        text: userMessageContent,
        synthetic: null,
        time: null,
      }]

      const optimisticMessageWithParts: MessageWithParts = {
        info: userMessageInfo,
        parts: userMessageParts,
      }

      queryClient.setQueryData<MessageWithParts[]>(
        messagesQueryKey(serverUrl, sessionId, directory),
        (old) => [...(old || []), optimisticMessageWithParts]
      )

      const request = {
        parts: [{ type: 'text' as const, text: userMessageContent }],
        model: null as { providerId: string; modelId: string } | null,
        agent: agent ?? null,
        variant: null as string | null,
      }

      if (model) {
        const [providerId, modelId] = model.split('/')
        if (providerId && modelId) {
          request.model = { providerId, modelId }
        }
      }

      await createBffClient(serverUrl).sendPrompt(
        sessionId,
        request,
        directory ? [directory] : [],
      )

      return { optimisticUserID, userMessageContent }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: messagesQueryKey(serverUrl, sessionId, directory)
      })
      queryClient.invalidateQueries({
        queryKey: sessionQueryKey(serverUrl, sessionId, directory)
      })
    },
    onError: (_, variables) => {
      void variables
      queryClient.setQueryData<MessageWithParts[]>(
        messagesQueryKey(serverUrl, sessionId, directory),
        (old) => {
          const messages = old || []
          const optimisticIndex = messages.findIndex((m) => m.info.id.startsWith('optimistic_user_'))
          if (optimisticIndex !== -1) {
            return messages.slice(0, optimisticIndex)
          }
          return messages
        }
      )
      showToast.error(t('message.errors.refreshFailed'))
    }
  })
}
