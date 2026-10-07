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
const DISCOVERY_CACHE_VERSION = 'v3'

/**
 * The capability is part of the key, not just the filter. TTS and STT both pass
 * `type: 'models'`, so against one endpoint they collided on a single entry:
 * whichever panel refreshed first wrote its own list, and the other panel read
 * it back and offered speech-to-text models to a text-to-speech field.
 */
function generateDiscoveryCacheKey(
  baseUrl: string,
  apiKey: string,
  type: string,
  capability?: string,
): string {
  const hash = createHash('sha256')
  hash.update(`${DISCOVERY_CACHE_VERSION}|${baseUrl}|${apiKey}|${type}|${capability ?? ''}`)
  return hash.digest('hex')
}

/**
 * `defaults` means the upstream was asked and nothing usable came back, so what
 * the caller is about to show is a hardcoded list rather than the provider's.
 * It has to travel with the list; a silent fallback is indistinguishable from a
 * provider that only offers three models.
 */
export type DiscoverySource = 'discovered' | 'defaults'

/**
 * One entry of a `/v1/models` list. `relay` is not part of the OpenAI schema -
 * it is the extra block a self-hosted gateway adds - so every field of it is
 * treated as optional and possibly absent.
 */
interface ModelListEntry {
  id?: string
  relay?: { capability?: unknown; kind?: unknown }
}

/**
 * Whether one entry belongs on the TTS or the STT picker.
 *
 * Matching the model id was a guess dressed up as a filter: `/whisper|transcri/`
 * keeps every model ever named after its own purpose, and it drops the ones
 * named after the vendor instead. RelayAB lists `asr-1.0` on `/v1/models` and
 * tags it `relay.capability: "audio.stt"`; the name contains neither `whisper`
 * nor `transcri`, so the only speech-to-text model the provider actually offered
 * was the one we discarded - and the picker then showed `whisper-1`, which that
 * provider does not have.
 *
 * A gateway that tags its entries is believed over the name, in both
 * directions: a tag keeps a model whose name says nothing, and excludes one
 * whose name would have matched by accident (`speech-2.8-hd` is a TTS model, and
 * the STT filter must never offer it). A provider with no tags still gets the
 * name test, widened to cover `asr` and `stt` alongside the old two.
 *
 * With no capability asked for the call site wants the whole list - the
 * OpenCode model picker passes a pattern that matches every name - and the tags
 * are left alone.
 */
function entryMatchesCapability(
  entry: ModelListEntry,
  capability: string | undefined,
  filterPattern: RegExp,
): boolean {
  if (capability === undefined) {
    return filterPattern.test((entry.id ?? '').toLowerCase())
  }

  const tagged = typeof entry.relay?.capability === 'string' ? entry.relay.capability : undefined
  if (tagged !== undefined) return tagged === capability

  return filterPattern.test((entry.id ?? '').toLowerCase())
}

/**
 * The model ids from one `/v1/models` body that belong on this call site's
 * picker. Exported because the decision is the whole of model discovery: a
 * route-level test that mocks `discoverModelsCached` out never reaches it.
 */
export function selectModels(
  data: unknown,
  capability: string | undefined,
  filterPattern: RegExp,
): string[] {
  if (data !== null && typeof data === 'object' && 'data' in data) {
    const entries = (data as { data?: unknown }).data
    if (!Array.isArray(entries)) return []

    return entries
      .filter((model): model is ModelListEntry =>
        model !== null && typeof model === 'object')
      .filter((model) => model.id && typeof model.id === 'string')
      .filter((model) => entryMatchesCapability(model, capability, filterPattern))
      .map((model) => model.id!)
  }

  // Some gateways answer with a bare array of ids. There are no tags to read,
  // so the name is all there is.
  if (Array.isArray(data)) {
    return data.filter((item): item is string =>
      typeof item === 'string' && filterPattern.test(item.toLowerCase())
    )
  }

  return []
}

async function fetchAvailableModels(
  baseUrl: string,
  apiKey: string,
  filterPattern: RegExp,
  defaultModels: string[],
  capability?: string,
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
        const data: unknown = await response.json()

        const filtered = selectModels(data, capability, filterPattern)
        if (filtered.length > 0) {
          return { models: filtered, source: 'discovered' }
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
  /** Narrows the cache entry to one capability; see `discoverModelsCached`. */
  capability?: string
  forceRefresh: boolean
  fetcher: () => Promise<T>
}): Promise<{ value: T; cached: boolean }> {
  const cacheKey = generateDiscoveryCacheKey(opts.baseUrl, opts.apiKey, opts.type, opts.capability)

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
  /**
   * The capability the call site is looking for, e.g. `audio.stt`. A provider
   * that tags its `/v1/models` entries with `relay.capability` is filtered on
   * that tag; one that does not falls back to `filterPattern`.
   */
  capability?: string
  defaultModels: string[]
  forceRefresh: boolean
}): Promise<{ models: string[]; cached: boolean; source: DiscoverySource }> {
  const fetchModels = () => fetchAvailableModels(
    opts.baseUrl,
    opts.apiKey,
    opts.filterPattern,
    opts.defaultModels,
    opts.capability,
  )

  const { value, cached } = await discoverCached({
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    type: opts.type,
    capability: opts.capability,
    forceRefresh: opts.forceRefresh,
    fetcher: fetchModels,
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
      capability: opts.capability,
      forceRefresh: true,
      fetcher: fetchModels,
    })
    return { models: fresh.models, source: fresh.source, cached: false }
  }

  return { models: value.models, source: value.source, cached }
}
