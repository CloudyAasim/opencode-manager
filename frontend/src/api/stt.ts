import { API_BASE_URL } from '@/config'
import { fetchWrapper, FetchError } from './fetchWrapper'
import { formatUpstreamFailure } from '@/lib/upstream-error'

export interface STTModelsResponse {
  models: string[]
  cached: boolean
  /** 'defaults' means the provider offered no list; the models are built-in */
  source?: 'discovered' | 'defaults'
}

export interface STTStatusResponse {
  enabled: boolean
  configured: boolean
  provider: 'external' | 'builtin'
  model: string
}

export interface STTTranscribeResponse {
  text: string
}

export interface STTErrorResponse {
  error: string
  details?: string
}

export const sttApi = {
  getModels: async (forceRefresh = false): Promise<STTModelsResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/stt/models`, {
      params: { ...(forceRefresh && { refresh: 'true' }) },
    })
  },

  getStatus: async (): Promise<STTStatusResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/stt/status`)
  },

  transcribe: async (
    audioBlob: Blob,
    signal?: AbortSignal
  ): Promise<STTTranscribeResponse> => {
    const formData = new FormData()

    const type = audioBlob.type
    const extension =
      type.includes('wav') ? 'wav' :
      type.includes('webm') ? 'webm' :
      type.includes('ogg') ? 'ogg' :
      type.includes('mp4') ? 'm4a' : 'wav'
    formData.append('audio', audioBlob, `recording.${extension}`)

    const urlObj = new URL(`${API_BASE_URL}/api/stt/transcribe`, window.location.origin)

    const controller = new AbortController()
    let timeoutFired = false
    const timeoutId = setTimeout(() => {
      timeoutFired = true
      controller.abort()
    }, 60000)

    if (signal?.aborted) {
      controller.abort()
    }
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })

    try {
      const response = await fetch(urlObj.toString(), {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', onAbort)

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new FetchError(
          formatUpstreamFailure(data, response.status, 'Transcription failed'),
          response.status,
        )
      }

      return response.json()
    } catch (error) {
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', onAbort)

      if (error instanceof Error && error.name === 'AbortError') {
        if (signal?.aborted && !timeoutFired) {
          throw new FetchError('Transcription canceled', 499, 'CANCELED')
        }
        throw new FetchError('Transcription timeout', 408, 'TIMEOUT')
      }
      throw error
    }
  },
}
