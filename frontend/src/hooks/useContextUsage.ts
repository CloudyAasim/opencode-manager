import { useMemo } from 'react'
import { useMessages } from './useOpenCode'
import { useQuery } from '@tanstack/react-query'
import { fetchWrapper } from '@/api/fetchWrapper'

interface ContextUsage {
  totalTokens: number
  contextLimit: number | null
  usagePercentage: number | null
  currentModel: string | null
  isLoading: boolean
}

interface ModelLimit {
  context: number
  output: number
}

interface ProviderModel {
  id: string
  name: string
  limit: ModelLimit
}

interface Provider {
  id: string
  name: string
  models: Record<string, ProviderModel>
}

interface ProvidersResponse {
  providers: Provider[]
}

async function fetchProviders(opcodeUrl: string): Promise<ProvidersResponse> {
  return fetchWrapper<ProvidersResponse>(`${opcodeUrl}/config/providers`)
}

export const useContextUsage = (serverUrl: string | null | undefined, opcodeUrl: string | null | undefined, sessionID: string | undefined, directory?: string): ContextUsage => {
  const { data: messages, isLoading: messagesLoading } = useMessages(serverUrl, sessionID, directory)

  const { data: providersData } = useQuery({
    queryKey: ['providers', opcodeUrl],
    queryFn: () => {
      if (!opcodeUrl) throw new Error('opcodeUrl is required')
      return fetchProviders(opcodeUrl)
    },
    enabled: !!opcodeUrl,
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
      const [providerId, modelId] = currentModel.split('/')
      // The list of providers may be missing from the answer, and a page that
      // cannot say how much of the context is used is still a page.
      const provider = (providersData.providers ?? []).find(p => p.id === providerId)
      if (provider?.models) {
        const model = provider.models[modelId]
        if (model?.limit) {
          contextLimit = model.limit.context
        }
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
