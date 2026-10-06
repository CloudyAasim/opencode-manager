import { Hono } from 'hono'
import { z } from 'zod'
import { Database } from 'bun:sqlite'
import { createHash } from 'crypto'
import { readFile, writeFile, readdir, stat, unlink } from 'fs/promises'
import { join } from 'path'
import { SettingsService } from '../services/settings'
import { logger } from '../utils/logger'
import { mkdirSafe } from '../utils/fs-safe'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'
import {
  normalizeToBaseUrl,
  discoverModelsCached,
  discoverCached,
} from '../utils/discovery-cache'
import { describeUpstreamFailure, truncateUpstreamBody } from '../utils/upstream-error'
import { settingsOwnerId } from '../auth/settings-owner'

const TTS_CACHE_DIR = join(getWorkspacePath(), 'cache', 'tts')
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_CACHE_SIZE_MB = 200
const MAX_CACHE_SIZE_BYTES = MAX_CACHE_SIZE_MB * 1024 * 1024

const TTSRequestSchema = z.object({
  text: z.string().min(1).max(4096),
})

/**
 * The cache lives at one shared path for every user, so the key has to carry
 * who asked and against which upstream. Leaving the endpoint and the API key
 * out meant two users requesting the same sentence were served each other's
 * audio, and repointing the endpoint or rotating the key replayed the previous
 * bytes for 24 hours - which reads as "I changed the settings and nothing
 * happened".
 */
function generateCacheKey(
  text: string,
  voice: string,
  model: string,
  speed: number,
  endpoint: string,
  apiKey: string,
): string {
  const hash = createHash('sha256')
  hash.update(
    `${text}|${voice}|${model}|${speed}|${normalizeToBaseUrl(endpoint)}|${apiKey}`,
  )
  return hash.digest('hex')
}

/**
 * Relays answer an unknown model with HTTP 200 and a JSON error page. Without
 * this the body was written to the cache as `<key>.mp3` and replayed as audio
 * for a day. The content type is the primary signal; the magic-number check
 * covers upstreams that send nothing useful at all.
 */
function looksLikeAudio(contentType: string, buffer: Buffer): boolean {
  if (/^audio\//i.test(contentType)) return true
  if (buffer.length < 4) return false

  if (buffer.subarray(0, 3).toString('latin1') === 'ID3') return true
  // MPEG frame sync, 11 set bits
  if (buffer[0] === 0xff && ((buffer[1] ?? 0) & 0xe0) === 0xe0) return true
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
      buffer.subarray(8, 12).toString('latin1') === 'WAVE') return true
  if (buffer.subarray(0, 4).toString('latin1') === 'OggS') return true
  // ISO base media (m4a/aac)
  if (buffer.subarray(4, 8).toString('latin1') === 'ftyp') return true
  // Matroska / WebM
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return true

  return false
}

async function ensureCacheDir(): Promise<void> {
  await mkdirSafe(TTS_CACHE_DIR)
}

async function getCachedAudio(cacheKey: string): Promise<Buffer | null> {
  try {
    const filePath = join(TTS_CACHE_DIR, `${cacheKey}.mp3`)
    const fileStat = await stat(filePath)
    
    if (Date.now() - fileStat.mtimeMs > CACHE_TTL_MS) {
      await unlink(filePath)
      return null
    }
    
    return await readFile(filePath)
  } catch {
    return null
  }
}

async function getCacheSize(): Promise<number> {
  try {
    const files = await readdir(TTS_CACHE_DIR)
    let totalSize = 0
    
    for (const file of files) {
      if (!file.endsWith('.mp3')) continue
      
      const filePath = join(TTS_CACHE_DIR, file)
      const fileStat = await stat(filePath)
      totalSize += fileStat.size
    }
    
    return totalSize
  } catch {
    return 0
  }
}

async function cleanupOldestFiles(requiredSpace: number): Promise<void> {
  try {
    const files = await readdir(TTS_CACHE_DIR)
    const fileInfos = []
    
    for (const file of files) {
      if (!file.endsWith('.mp3')) continue
      
      const filePath = join(TTS_CACHE_DIR, file)
      const fileStat = await stat(filePath)
      fileInfos.push({ path: filePath, mtimeMs: fileStat.mtimeMs, size: fileStat.size })
    }
    
    fileInfos.sort((a, b) => a.mtimeMs - b.mtimeMs)
    
    let freedSpace = 0
    for (const fileInfo of fileInfos) {
      await unlink(fileInfo.path)
      freedSpace += fileInfo.size
      
      if (freedSpace >= requiredSpace) break
    }
    
    logger.info(`TTS cache freed ${freedSpace} bytes by removing old files`)
  } catch (error) {
    logger.error('TTS cache cleanup failed:', error)
  }
}

async function cacheAudio(cacheKey: string, audioData: Buffer): Promise<void> {
  const filePath = join(TTS_CACHE_DIR, `${cacheKey}.mp3`)
  
  await ensureCacheDir()
  const currentCacheSize = await getCacheSize()
  
  if (currentCacheSize + audioData.length > MAX_CACHE_SIZE_BYTES) {
    await cleanupOldestFiles(audioData.length)
  }
  
  await writeFile(filePath, audioData)
}



/**
 * None of these is an OpenAI endpoint - OpenAI has no voices route at all.
 * They are here because Kokoro-style servers do expose one, and for everyone
 * else the three requests 404 and the caller is told so via `source`, rather
 * than being handed OpenAI's six voices as if the provider had offered them.
 */
async function fetchAvailableVoices(
  endpoint: string,
  apiKey: string,
): Promise<{ voices: string[]; source: 'discovered' | 'defaults' }> {
  const baseUrl = normalizeToBaseUrl(endpoint)
  const endpointVariations = [
    `${baseUrl}/v1/audio/voices`,
    `${baseUrl}/voices`,
    `${baseUrl}/audio/voices`,
  ]

  for (const voiceEndpoint of endpointVariations) {
    try {
      const response = await fetch(voiceEndpoint, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      })

      if (response.ok) {
        type VoiceItem = { id?: string; name?: string; voice?: string }
        const data = await response.json() as { data?: VoiceItem[]; voices?: string[] } | (string | VoiceItem)[]

        if ('data' in data && Array.isArray(data.data)) {
          const voices = data.data
            .filter((voice) => voice.id || voice.name)
            .map((voice) => (voice.id || voice.name)!)
          if (voices.length > 0) return { voices, source: 'discovered' }
        } else if ('voices' in data && Array.isArray(data.voices)) {
          const voices = data.voices.filter((v): v is string => typeof v === 'string')
          if (voices.length > 0) return { voices, source: 'discovered' }
        } else if (Array.isArray(data)) {
          const voices = data.map((item) => {
            if (typeof item === 'string') return item
            return item.name || item.voice || item.id
          }).filter((v): v is string => typeof v === 'string')
          if (voices.length > 0) return { voices, source: 'discovered' }
        }
      }
    } catch (error) {
      logger.warn(`Failed to fetch voices from ${voiceEndpoint}:`, error)
      continue
    }
  }

  logger.warn(
    `No voice list discovered at ${baseUrl}; falling back to OpenAI's six names, which the provider may not have`,
  )
  return {
    voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
    source: 'defaults',
  }
}

export async function cleanupExpiredCache(): Promise<number> {
  try {
    await ensureCacheDir()
    const files = await readdir(TTS_CACHE_DIR)
    let cleanedCount = 0
    
    for (const file of files) {
      if (!file.endsWith('.mp3')) continue
      
      const filePath = join(TTS_CACHE_DIR, file)
      try {
        const fileStat = await stat(filePath)
        if (Date.now() - fileStat.mtimeMs > CACHE_TTL_MS) {
          await unlink(filePath)
          cleanedCount++
        }
      } catch {
        continue
      }
    }
    
    if (cleanedCount > 0) {
      logger.info(`TTS cache cleanup: removed ${cleanedCount} expired files`)
    }
    
    return cleanedCount
  } catch (error) {
    logger.error('TTS cache cleanup failed:', error)
    return 0
  }
}

export async function getCacheStats(): Promise<{ count: number; sizeBytes: number; sizeMB: number }> {
  try {
    await ensureCacheDir()
    const files = await readdir(TTS_CACHE_DIR)
    let count = 0
    let totalSize = 0
    
    for (const file of files) {
      if (!file.endsWith('.mp3')) continue
      
      const filePath = join(TTS_CACHE_DIR, file)
      const fileStat = await stat(filePath)
      
      if (Date.now() - fileStat.mtimeMs <= CACHE_TTL_MS) {
        count++
        totalSize += fileStat.size
      }
    }
    
    return {
      count,
      sizeBytes: totalSize,
      sizeMB: Math.round(totalSize / (1024 * 1024) * 100) / 100
    }
  } catch {
    return { count: 0, sizeBytes: 0, sizeMB: 0 }
  }
}

export { generateCacheKey, ensureCacheDir, getCachedAudio, cacheAudio, getCacheSize, cleanupOldestFiles }

export function createTTSRoutes(db: Database) {
  const app = new Hono()

  app.post('/synthesize', async (c) => {
    const abortController = new AbortController()
    
    c.req.raw.signal.addEventListener('abort', () => {
      logger.info('TTS request aborted by client')
      abortController.abort()
    })
    
    try {
      const body = await c.req.json()
      const { text } = TTSRequestSchema.parse(body)
      const userId = settingsOwnerId(c)
      
      const settingsService = new SettingsService(db)
      const settings = settingsService.getSettings(userId)
      const ttsConfig = settings.preferences.tts
      
      if (!ttsConfig?.enabled) {
        return c.json({ error: 'TTS is not enabled' }, 400)
      }
      
      if (!ttsConfig.apiKey) {
        return c.json({ error: 'TTS API key is not configured' }, 400)
      }
      
      const { endpoint, apiKey, voice, model, speed } = ttsConfig
      const cacheKey = generateCacheKey(text, voice, model, speed, endpoint, apiKey)
      
      await ensureCacheDir()
      
      const cachedAudio = await getCachedAudio(cacheKey)
      if (cachedAudio) {
        logger.info(`TTS cache hit: ${cacheKey.substring(0, 8)}...`)
        return new Response(cachedAudio, {
          headers: {
            'Content-Type': 'audio/mpeg',
            'X-Cache': 'HIT',
          },
        })
      }
      
      if (abortController.signal.aborted) {
        return new Response(null, { status: 499 })
      }
      
      logger.info(`TTS cache miss, calling API: ${cacheKey.substring(0, 8)}...`)
      
      const baseUrl = normalizeToBaseUrl(endpoint)
      const speechEndpoint = `${baseUrl}/v1/audio/speech`
      
      const response = await fetch(speechEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          voice,
          input: text,
          speed,
          response_format: 'mp3',
        }),
        signal: abortController.signal,
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        logger.error(`TTS API error: ${response.status} - ${errorText}`)
        const status = response.status >= 400 && response.status < 600 ? response.status as 400 | 500 : 500

        return c.json({
          ...describeUpstreamFailure({
            error: 'TTS API request failed',
            status: response.status,
            body: errorText,
          }),
          voice: voice,
          availableVoices: ttsConfig?.availableVoices || []
        }, status)
      }
      
      const contentType = response.headers.get('content-type') ?? ''
      const audioBuffer = Buffer.from(await response.arrayBuffer())

      if (!looksLikeAudio(contentType, audioBuffer)) {
        const body = audioBuffer.toString('utf-8')
        logger.error(
          `TTS API returned a non-audio body: content-type=${contentType || '(none)'} - ${truncateUpstreamBody(body, 200)}`,
        )
        return c.json(describeUpstreamFailure({
          error: 'TTS API returned a non-audio response',
          status: 502,
          body,
        }), 502)
      }

      await cacheAudio(cacheKey, audioBuffer)
      logger.info(`TTS audio cached: ${cacheKey.substring(0, 8)}...`)
      
      return new Response(audioBuffer, {
        headers: {
          'Content-Type': 'audio/mpeg',
          'X-Cache': 'MISS',
        },
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return new Response(null, { status: 499 })
      }
      logger.error('TTS synthesis failed:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request', details: error.issues }, 400)
      }
      return c.json({ error: 'TTS synthesis failed' }, 500)
    }
  })

  app.get('/models', async (c) => {
    try {
      const userId = settingsOwnerId(c)
      const forceRefresh = c.req.query('refresh') === 'true'
      
      const settingsService = new SettingsService(db)
      const settings = settingsService.getSettings(userId)
      const ttsConfig = settings.preferences.tts
      
      if (!ttsConfig?.apiKey || !ttsConfig?.endpoint) {
        return c.json({ error: 'TTS not configured' }, 400)
      }
      
      const { models, cached, source } = await discoverModelsCached({
        baseUrl: ttsConfig.endpoint,
        apiKey: ttsConfig.apiKey,
        type: 'models',
        filterPattern: /tts|audio|speech/,
        defaultModels: ['tts-1', 'tts-1-hd'],
        forceRefresh,
      })

      if (!cached) {
        await settingsService.updateSettings({
          tts: {
            ...ttsConfig,
            availableModels: models,
            lastModelsFetch: Date.now(),
          },
        }, userId)
      }

      return c.json({ models, source, cached })
    } catch (error) {
      logger.error('Failed to fetch TTS models:', error)
      return c.json({ error: 'Failed to fetch models' }, 500)
    }
  })

  app.get('/voices', async (c) => {
    try {
      const userId = settingsOwnerId(c)
      const forceRefresh = c.req.query('refresh') === 'true'
      
      const settingsService = new SettingsService(db)
      const settings = settingsService.getSettings(userId)
      const ttsConfig = settings.preferences.tts
      
      if (!ttsConfig?.apiKey || !ttsConfig?.endpoint) {
        return c.json({ error: 'TTS not configured' }, 400)
      }
      
      const { value, cached } = await discoverCached({
        baseUrl: ttsConfig.endpoint,
        apiKey: ttsConfig.apiKey,
        type: 'voices',
        forceRefresh,
        fetcher: () => fetchAvailableVoices(ttsConfig.endpoint, ttsConfig.apiKey),
      })

      if (!cached) {
        await settingsService.updateSettings({
          tts: {
            ...ttsConfig,
            availableVoices: value.voices,
            lastVoicesFetch: Date.now(),
          },
        }, userId)
      }

      return c.json({ voices: value.voices, source: value.source, cached })
    } catch (error) {
      logger.error('Failed to fetch TTS voices:', error)
      return c.json({ error: 'Failed to fetch voices' }, 500)
    }
  })

  app.get('/status', async (c) => {
    const userId = settingsOwnerId(c)
    const settingsService = new SettingsService(db)
    const settings = settingsService.getSettings(userId)
    const ttsConfig = settings.preferences.tts
    const cacheStats = await getCacheStats()
    
    return c.json({
      enabled: ttsConfig?.enabled || false,
      configured: !!(ttsConfig?.apiKey),
      cache: {
        ...cacheStats,
        maxSizeMB: MAX_CACHE_SIZE_MB,
        ttlHours: CACHE_TTL_MS / (60 * 60 * 1000)
      }
    })
  })

  return app
}
