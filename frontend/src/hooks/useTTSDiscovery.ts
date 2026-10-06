import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ttsApi } from '@/api/tts'

export function useTTSModels(enabled = true) {
  return useQuery({
    queryKey: ['tts-models'],
    queryFn: () => ttsApi.getModels(),
    enabled,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  })
}

export function useTTSVoices(enabled = true) {
  return useQuery({
    queryKey: ['tts-voices'],
    queryFn: () => ttsApi.getVoices(),
    enabled,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  })
}

export function useTTSDiscovery() {
  const queryClient = useQueryClient()

  const refreshModels = async () => {
    const result = await ttsApi.getModels(true)
    queryClient.setQueryData(['tts-models'], result)
    return result
  }

  const refreshVoices = async () => {
    const result = await ttsApi.getVoices(true)
    queryClient.setQueryData(['tts-voices'], result)
    return result
  }

  const refreshAll = async () => {
    const [models, voices] = await Promise.all([
      refreshModels(),
      refreshVoices()
    ])
    return { models, voices }
  }

  return {
    refreshModels,
    refreshVoices,
    refreshAll,
    invalidateModels: () => queryClient.invalidateQueries({ queryKey: ['tts-models'] }),
    invalidateVoices: () => queryClient.invalidateQueries({ queryKey: ['tts-voices'] }),
    invalidateAll: () => {
      queryClient.invalidateQueries({ queryKey: ['tts-models'] })
      queryClient.invalidateQueries({ queryKey: ['tts-voices'] })
    }
  }
}
