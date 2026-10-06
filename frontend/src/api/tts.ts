import { API_BASE_URL } from '@/config'
import { fetchWrapper } from './fetchWrapper'

/**
 * `discovered` means the provider's own list; `defaults` means the endpoint was
 * asked and nothing usable came back, so what follows is a hardcoded list. The
 * UI has to say so, otherwise a default looks like an offer.
 */
export type DiscoverySource = 'discovered' | 'defaults'

export interface TTSModelsResponse {
  models: string[]
  cached: boolean
  source?: DiscoverySource
}

export interface TTSVoicesResponse {
  voices: string[]
  cached: boolean
  source?: DiscoverySource
}

export interface TTSStatusResponse {
  enabled: boolean
  configured: boolean
  cache: {
    count: number
    sizeBytes: number
    sizeMB: number
    maxSizeMB: number
    ttlHours: number
  }
}

// No userId is sent. The TTS routes take their owner from the session, and
// while they still honoured `?userId=` the panel was writing one user and
// asking about another - which is why an enabled TTS could never be heard.
export const ttsApi = {
  getModels: async (forceRefresh = false): Promise<TTSModelsResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/tts/models`, {
      params: { ...(forceRefresh && { refresh: 'true' }) },
    })
  },

  getVoices: async (forceRefresh = false): Promise<TTSVoicesResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/tts/voices`, {
      params: { ...(forceRefresh && { refresh: 'true' }) },
    })
  },

  getStatus: async (): Promise<TTSStatusResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/tts/status`)
  },
}
