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

export const ttsApi = {
  getModels: async (userId = 'default', forceRefresh = false): Promise<TTSModelsResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/tts/models`, {
      params: { userId, ...(forceRefresh && { refresh: 'true' }) },
    })
  },

  getVoices: async (userId = 'default', forceRefresh = false): Promise<TTSVoicesResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/tts/voices`, {
      params: { userId, ...(forceRefresh && { refresh: 'true' }) },
    })
  },

  getStatus: async (userId = 'default'): Promise<TTSStatusResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/tts/status`, {
      params: { userId },
    })
  },
}
