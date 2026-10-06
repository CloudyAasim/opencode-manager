import { createHash } from 'crypto'
import { readFile, writeFile, stat, unlink } from 'fs/promises'
import { join } from 'path'
import { logger } from './logger'
import { mkdirSafe } from './fs-safe'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'

const DISCOVERY_CACHE_DIR = join(getWorkspacePath(), 'cache', 'discovery')
const DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000

/**
 * Segments that mean "this is an API call", not "this is the base". A relay
 * station's documented base is `https://host/v1`, while the UI placeholder is
 * `https://api.openai.com`; both are legitimate and the call sites append their
 * own `/v1`, so the version has to come off again. Users also paste whole
 * endpoints. This walks the path from the end and drops those words instead of
 * matching a growing list of exact suffixes.
 */
const API_RESOURCE_SEGMENTS = new Set(['audio', 'speech', 'transcriptions', 'models', 'voices'])
const VERSION_SEGMENT = /^v\d+$/i

/**
 * Reduce any of the accepted endpoint spellings to a base that the call sites
 * can append `/v1/audio/speech` or `/v1/audio/transcriptions` to.
 *
 * `https://relay.example.com`, `https://relay.example.com/v1` and
 * `https://relay.example.com/v1/audio/speech` all normalize to
 * `https://relay.example.com`. Previously a `/v1` suffix survived, so the two
 * first spellings produced `.../v1/v1/audio/speech` and a 404 - invisible with
 * api.openai.com, and fatal with the relay stations that document a `/v1` base.
 */
export function normalizeToBaseUrl(endpoint: string): string {
  const trimmed = (endpoint ?? '').trim()
  if (!trimmed) return trimmed

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    // not an absolute URL; keep the old forgiving behaviour rather than throw
    return trimmed.replace(/\/+$/, '')
  }

  // a query or fragment cannot be concatenated with a path, so it is dropped
  url.search = ''
  url.hash = ''

  const segments = url.pathname.split('/').filter(Boolean)
  while (segments.length > 0) {
    const last = segments.at(-1)
    if (last === undefined) break
    if (API_RESOURCE_SEGMENTS.has(last.toLowerCase()) || VERSION_SEGMENT.test(last)) {
      segments.pop()
      continue
    }
    break
  }

  url.pathname = segments.length > 0 ? `/${segments.join('/')}` : '/'
  return url.toString().replace(/\/$/, '')
}

async function ensureDiscoveryCacheDir(): Promise<void> {
  await mkdirSafe(DISCOVERY_CACHE_DIR)
}

async function getCachedDiscovery<T>(cacheKey: string): Promise<T | null> {
  try {
    const filePath = join(DISCOVERY_CACHE_DIR, `${cacheKey}.json`)
    const fileStat = await stat(filePath)

    if (Date.now() - fileStat.mtimeMs > DISCOVERY_CACHE_TTL_MS) {
      await unlink(filePath)
      return null
    }

    const content = await readFile(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

async function cacheDiscovery<T>(cacheKey: string, data: T): Promise<void> {
  try {
    await ensureDiscoveryCacheDir()
    const filePath = join(DISCOVERY_CACHE_DIR, `${cacheKey}.json`)
    await writeFile(filePath, JSON.stringify(data))
  } catch (error) {
    logger.error(`Failed to cache discovery data for ${cacheKey}:`, error)
  }
}

/**
 * Bumped when the cached value's shape changes. Entries written by an older
 * build are then simply never read - they are not deleted eagerly, they age
 * out through the TTL on the next lookup of the same key.
 */
const DISCOVERY_CACHE_VERSION = 'v2'

function generateDiscoveryCacheKey(baseUrl: string, apiKey: string, type: string): string {
  const hash = createHash('sha256')
  hash.update(`${DISCOVERY_CACHE_VERSION}|${baseUrl}|${apiKey}|${type}`)
  return hash.digest('hex')
}

/**
 * `defaults` means the upstream was asked and nothing usable came back, so what
 * the caller is about to show is a hardcoded list rather than the provider's.
 * It has to travel with the list; a silent fallback is indistinguishable from a
 * provider that only offers three models.
 */
export type DiscoverySource = 'discovered' | 'defaults'

async function fetchAvailableModels(
  baseUrl: string,
  apiKey: string,
  filterPattern: RegExp,
  defaultModels: string[],
): Promise<{ models: string[]; source: DiscoverySource }> {
  const normalizedUrl = normalizeToBaseUrl(baseUrl)
  const endpointVariations = [
    `${normalizedUrl}/v1/models`,
    `${normalizedUrl}/models`,
  ]

  for (const modelEndpoint of endpointVariations) {
    try {
      const response = await fetch(modelEndpoint, {
        headers: {
          ...(apiKey && { 'Authorization': `Bearer ${apiKey}` }),
          'Content-Type': 'application/json',
        },
      })

      if (response.ok) {
        const data = await response.json() as { data?: { id?: string }[] } | unknown[]

        if ('data' in data && Array.isArray(data.data)) {
          const filtered = data.data
            .filter((model) => model.id && typeof model.id === 'string')
            .filter((model) => filterPattern.test(model.id!.toLowerCase()))
            .map((model) => model.id!)

          if (filtered.length > 0) {
            return { models: filtered, source: 'discovered' }
          }
        } else if (Array.isArray(data)) {
          const filtered = data.filter((item): item is string =>
            typeof item === 'string' && filterPattern.test(item.toLowerCase())
          )
          if (filtered.length > 0) {
            return { models: filtered, source: 'discovered' }
          }
        }
      }
    } catch (error) {
      logger.warn(`Failed to fetch models from ${modelEndpoint}:`, error)
      continue
    }
  }

  // A relay lists chat, embedding and image models too, so a provider whose
  // TTS model is named something else matches nothing here. Saying so beats
  // showing 'tts-1' as though the provider had offered it.
  logger.warn(
    `No TTS/STT model discovered at ${normalizedUrl}; falling back to built-in defaults: ${defaultModels.join(', ')}`,
  )
  return { models: defaultModels, source: 'defaults' }
}

export async function discoverCached<T>(opts: {
  baseUrl: string
  apiKey: string
  type: string
  forceRefresh: boolean
  fetcher: () => Promise<T>
}): Promise<{ value: T; cached: boolean }> {
  const cacheKey = generateDiscoveryCacheKey(opts.baseUrl, opts.apiKey, opts.type)

  if (!opts.forceRefresh) {
    const cached = await getCachedDiscovery<T>(cacheKey)
    if (cached) return { value: cached, cached: true }
  }

  await ensureDiscoveryCacheDir()
  logger.info(`Discovering ${opts.type} from ${opts.baseUrl}`)

  const value = await opts.fetcher()
  await cacheDiscovery(cacheKey, value)

  return { value, cached: false }
}

export async function discoverModelsCached(opts: {
  baseUrl: string
  apiKey: string
  type: string
  filterPattern: RegExp
  defaultModels: string[]
  forceRefresh: boolean
}): Promise<{ models: string[]; cached: boolean; source: DiscoverySource }> {
  const { value, cached } = await discoverCached({
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    type: opts.type,
    forceRefresh: opts.forceRefresh,
    fetcher: () => fetchAvailableModels(opts.baseUrl, opts.apiKey, opts.filterPattern, opts.defaultModels),
  })

  // A cache entry from an older build is a bare array, not this shape. Reading
  // it as-is would return `models: undefined` to the UI, so it is treated as a
  // miss and rediscovered rather than trusted.
  if (!value || !Array.isArray(value.models)) {
    logger.warn(
      `Ignoring unusable ${opts.type} discovery cache; rediscovering from ${opts.baseUrl}`,
    )
    const { value: fresh } = await discoverCached({
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
      type: opts.type,
      forceRefresh: true,
      fetcher: () => fetchAvailableModels(opts.baseUrl, opts.apiKey, opts.filterPattern, opts.defaultModels),
    })
    return { models: fresh.models, source: fresh.source, cached: false }
  }

  return { models: value.models, source: value.source, cached }
}
