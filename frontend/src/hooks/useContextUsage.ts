import { useMemo } from 'react'
import { useMessages } from './useOpenCode'
import { useQuery } from '@tanstack/react-query'
import { findSelectedModel, getProviders, providersQueryKey } from '@/api/providers'

interface ContextUsage {
  totalTokens: number
  contextLimit: number | null
  usagePercentage: number | null
  currentModel: string | null
  isLoading: boolean
}

export const useContextUsage = (serverUrl: string | null | undefined, sessionID: string | undefined, directory?: string): ContextUsage => {
  const { data: messages, isLoading: messagesLoading } = useMessages(serverUrl, sessionID, directory)

  // The catalogue comes from the layer the client talks to, like everything
  // else. It used to be asked of the agent directly, at a path the client
  // built itself - and the answer it read back was the agent's own, in the
  // agent's own words.
  //
  // The key is the one the model pickers use, so that the catalogue is asked
  // for once rather than once per place that draws it.
  const { data: providersData } = useQuery({
    queryKey: providersQueryKey(directory),
    queryFn: () => getProviders(directory),
    enabled: serverUrl !== undefined && serverUrl !== null,
    staleTime: 5 * 60 * 1000,
  })

  return useMemo(() => {
    const assistantMessages = messages?.filter(msg => msg.info.role === 'assistant') || []
    let latestAssistantMessage = assistantMessages[assistantMessages.length - 1]

    const sumTokens = (msg: typeof latestAssistantMessage) => {
      if (msg?.info.role !== 'assistant') return 0
      const tokens = msg.info.tokens
      if (!tokens) return 0
      return tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead
    }

    if (sumTokens(latestAssistantMessage) === 0 && assistantMessages.length > 1) {
      latestAssistantMessage = assistantMessages[assistantMessages.length - 2]
    }

    const currentModel = (() => {
      if (!latestAssistantMessage || latestAssistantMessage.info.role !== 'assistant') {
        return null
      }
      const msg = latestAssistantMessage.info
      if (msg.providerId && msg.modelId) {
        return `${msg.providerId}/${msg.modelId}`
      }
      return null
    })()

    let contextLimit: number | null = null
    if (currentModel && providersData) {
      // A model's name may itself contain slashes - the catalogue has names
      // like "auto/anthropic/claude-opus-4.7" - so only the first slash
      // separates the provider from the model. Splitting on every slash cut
      // the name in half, and the model was then not in the catalogue at all.
      const [providerId, ...modelParts] = currentModel.split('/')
      const modelId = modelParts.join('/')

      // The list of providers may be missing from the answer, and a page that
      // cannot say how much of the context is used is still a page.
      const selected = findSelectedModel(providersData.providers ?? [], providerId, modelId)
      const model = selected?.model
      if (model?.limit) {
        contextLimit = model.limit.context
      }
    }

    if (!messages || messages.length === 0) {
      return {
        totalTokens: 0,
        contextLimit,
        usagePercentage: contextLimit ? 0 : null,
        currentModel,
        isLoading: messagesLoading
      }
    }

    const totalTokens = sumTokens(latestAssistantMessage)

    const usagePercentage = contextLimit ? (totalTokens / contextLimit) * 100 : null

    return {
      totalTokens,
      contextLimit,
      usagePercentage,
      currentModel,
      isLoading: false
    }
  }, [messages, messagesLoading, providersData])
}
