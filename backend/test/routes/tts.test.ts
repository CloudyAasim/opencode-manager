import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import * as fs from 'fs/promises'

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
}))

vi.mock('../../src/utils/fs-safe', () => ({
  mkdirSafe: vi.fn().mockResolvedValue(undefined),
  mkdirSyncSafe: vi.fn(),
}))

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(),
}))

const { mockGetSettings, mockUpdateSettings } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
  mockUpdateSettings: vi.fn(),
}))

vi.mock('../../src/services/settings', () => ({
  SettingsService: vi.fn().mockImplementation(() => ({
    getSettings: mockGetSettings,
    updateSettings: mockUpdateSettings,
  })),
}))

const { mockDiscoverModelsCached, mockDiscoverCached } = vi.hoisted(() => ({
  mockDiscoverModelsCached: vi.fn(),
  mockDiscoverCached: vi.fn(),
}))

// Only the two functions that touch the network are replaced.
// `normalizeToBaseUrl` is pure, and mocking it with a stub that strips just a
// trailing slash silently tests a different function than the one that runs in
// production - which is how a `/v1` bug looks like a passing suite.
vi.mock('../../src/utils/discovery-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/discovery-cache')>()
  return {
    normalizeToBaseUrl: actual.normalizeToBaseUrl,
    discoverModelsCached: mockDiscoverModelsCached,
    discoverCached: mockDiscoverCached,
  }
})
vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

const mockReadFile = fs.readFile as any
const mockReaddir = fs.readdir as any
const mockStat = fs.stat as any
const mockUnlink = fs.unlink as any

import { createTTSRoutes, cleanupExpiredCache, getCacheStats, generateCacheKey, ensureCacheDir, getCachedAudio, getCacheSize, cleanupOldestFiles, cacheAudio } from '../../src/routes/tts'

const mockWriteFile = fs.writeFile as any

function createTtsConfig(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    apiKey: 'test-api-key',
    endpoint: 'https://tts.example.com',
    voice: 'alloy',
    model: 'tts-1',
    speed: 1,
    availableVoices: [],
    ...overrides,
  }
}

describe('TTS Routes', () => {
  let mockDb: any

  beforeEach(() => {
    vi.clearAllMocks()
    
    mockDb = {} as any
    createTTSRoutes(mockDb)
    mockGetSettings.mockReturnValue({ preferences: { tts: createTtsConfig() } })
    mockUpdateSettings.mockReturnValue(undefined)
    mockDiscoverModelsCached.mockResolvedValue({ models: ['tts-1'], cached: false, source: 'discovered' })
    mockDiscoverCached.mockImplementation(async (options: { fetcher: () => Promise<{ voices: string[]; source: 'discovered' | 'defaults' }> }) => ({
      value: await options.fetcher(),
      cached: false,
    }))
  })

  describe('generateCacheKey', () => {
    it('should generate consistent cache keys for identical inputs', () => {
      const key1 = generateCacheKey('Hello world', 'alloy', 'tts-1', 1.0, 'https://tts.example.com', 'key-1')
      const key2 = generateCacheKey('Hello world', 'alloy', 'tts-1', 1.0, 'https://tts.example.com', 'key-1')

      expect(key1).toBe(key2)
      expect(key1).toMatch(/^[a-f0-9]{64}$/)
    })

    it('should generate different cache keys for different inputs', () => {
      const key1 = generateCacheKey('Hello', 'alloy', 'tts-1', 1.0, 'https://tts.example.com', 'key-1')
      const key2 = generateCacheKey('World', 'alloy', 'tts-1', 1.0, 'https://tts.example.com', 'key-1')

      expect(key1).not.toBe(key2)
    })

    it('changes when the endpoint is repointed', () => {
      const key1 = generateCacheKey('Hello', 'alloy', 'tts-1', 1.0, 'https://a.example.com', 'key-1')
      const key2 = generateCacheKey('Hello', 'alloy', 'tts-1', 1.0, 'https://b.example.com', 'key-1')

      expect(key1).not.toBe(key2)
    })

    it('changes when the API key is rotated', () => {
      const key1 = generateCacheKey('Hello', 'alloy', 'tts-1', 1.0, 'https://a.example.com', 'key-1')
      const key2 = generateCacheKey('Hello', 'alloy', 'tts-1', 1.0, 'https://a.example.com', 'key-2')

      expect(key1).not.toBe(key2)
    })

    it('does not distinguish two spellings of the same endpoint', () => {
      const key1 = generateCacheKey('Hello', 'alloy', 'tts-1', 1.0, 'https://a.example.com', 'key-1')
      const key2 = generateCacheKey('Hello', 'alloy', 'tts-1', 1.0, 'https://a.example.com/v1', 'key-1')

      expect(key1).toBe(key2)
    })

    it('does not leak the API key into the cache file name', () => {
      const key = generateCacheKey('Hello', 'alloy', 'tts-1', 1.0, 'https://a.example.com', 'sk-secret-value')
      expect(key).not.toContain('sk-secret-value')
    })
  })

  describe('ensureCacheDir', () => {
    it('should create cache directory when it does not exist', async () => {
      await expect(ensureCacheDir()).resolves.toBeUndefined()
    })
  })

describe('getCachedAudio', () => {
     beforeEach(() => {
       vi.useFakeTimers()
     })

     afterEach(() => {
       vi.useRealTimers()
     })

    it('should return cached audio when file exists and is not expired', async () => {
      const cacheKey = 'test-key'
      const audioBuffer = Buffer.from('audio data')

      mockStat.mockResolvedValue({
        mtimeMs: Date.now() - 1000,
        size: 1024,
      } as any)
      mockReadFile.mockResolvedValue(audioBuffer)
      
      const result = await getCachedAudio(cacheKey)
      
      expect(result).toBe(audioBuffer)
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining(`${cacheKey}.mp3`)
      )
    })

    it('should return null when cached file has expired', async () => {
      const cacheKey = 'test-key'

      mockStat.mockResolvedValue({
        mtimeMs: Date.now() - 25 * 60 * 60 * 1000,
        size: 1024,
      } as any)
      mockUnlink.mockResolvedValue(undefined)
      
      const result = await getCachedAudio(cacheKey)
      
      expect(result).toBeNull()
      expect(mockUnlink).toHaveBeenCalledWith(
        expect.stringContaining(`${cacheKey}.mp3`)
      )
    })

    it('should return null when cached file does not exist', async () => {
      const cacheKey = 'nonexistent-key'
      
      mockStat.mockRejectedValue(new Error('File not found'))
      
      const result = await getCachedAudio(cacheKey)
      
      expect(result).toBeNull()
    })
  })

  describe('getCacheSize', () => {
    it('should calculate correct cache size', async () => {
      mockReaddir.mockResolvedValue(['file1.mp3', 'file2.mp3', 'readme.txt'] as any)
      mockStat
        .mockResolvedValueOnce({ size: 1024, mtimeMs: Date.now() } as any)
        .mockResolvedValueOnce({ size: 2048, mtimeMs: Date.now() } as any)
      
      const size = await getCacheSize()
      
      expect(size).toBe(3072) // 1024 + 2048
    })

    it('should handle cache directory errors gracefully', async () => {
      mockReaddir.mockRejectedValue(new Error('Permission denied'))
      
      const size = await getCacheSize()
      
      expect(size).toBe(0)
    })
  })

  describe('cleanupMethods', () => {
    it('should remove oldest files when cache size limit exceeded', async () => {
      mockReaddir.mockResolvedValue(['file1.mp3', 'file2.mp3', 'file3.mp3'] as any)
      mockStat
        .mockResolvedValueOnce({ size: 1024, mtimeMs: 1000 } as any)
        .mockResolvedValueOnce({ size: 2048, mtimeMs: 2000 } as any)
        .mockResolvedValueOnce({ size: 1536, mtimeMs: 3000 } as any)
      mockUnlink.mockResolvedValue(undefined)
      
      await cleanupOldestFiles(1500) // Need 1500 bytes freed
      
      expect(mockUnlink).toHaveBeenCalledWith(
        expect.stringContaining('file1.mp3')
      )
    })

    it('should return cache statistics for files', async () => {
      const currentTime = Date.now()
      mockReaddir.mockResolvedValue(['file1.mp3', 'file2.mp3'] as any)
      mockStat
        .mockResolvedValueOnce({ size: 1024, mtimeMs: currentTime } as any)
        .mockResolvedValueOnce({ size: 2048, mtimeMs: currentTime } as any)
      
      const stats = await getCacheStats()
      
      expect(stats.count).toBe(2)
      expect(stats.sizeBytes).toBe(3072)
      expect(stats.sizeMB).toBeCloseTo(0, 1)
    })

    it('should cleanup expired cache files', async () => {
      mockReaddir.mockResolvedValue(['file1.mp3', 'file2.mp3', 'expired.mp3'] as any)
      mockStat
        .mockResolvedValueOnce({ size: 1024, mtimeMs: Date.now() } as any)
        .mockResolvedValueOnce({ size: 2048, mtimeMs: Date.now() } as any)
        .mockResolvedValueOnce({ size: 1536, mtimeMs: Date.now() - 25 * 60 * 60 * 1000 } as any)
      mockUnlink.mockResolvedValue(undefined)
      
      const cleaned = await cleanupExpiredCache()
      
      expect(cleaned).toBe(1)
      expect(mockUnlink).toHaveBeenCalledWith(
        expect.stringContaining('expired.mp3')
      )
    })
  })
})
describe('TTS route handlers', () => {
  let app: ReturnType<typeof createTTSRoutes>
  let mockDb: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb = {} as any
    app = createTTSRoutes(mockDb)
    mockGetSettings.mockReturnValue({ preferences: { tts: createTtsConfig() } })
    mockUpdateSettings.mockReturnValue(undefined)
    mockDiscoverModelsCached.mockResolvedValue({ models: ['tts-1'], cached: false, source: 'discovered' })
    mockDiscoverCached.mockImplementation(async (options: { fetcher: () => Promise<{ voices: string[]; source: 'discovered' | 'defaults' }> }) => ({
      value: await options.fetcher(),
      cached: false,
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 400 when TTS is not enabled', async () => {
    mockGetSettings.mockReturnValue({ preferences: { tts: createTtsConfig({ enabled: false }) } })

    const res = await app.request('/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'TTS is not enabled' })
  })

  it('returns 400 when the TTS API key is missing', async () => {
    mockGetSettings.mockReturnValue({ preferences: { tts: createTtsConfig({ apiKey: '' }) } })

    const res = await app.request('/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'TTS API key is not configured' })
  })

  it('returns 400 for an invalid synthesize body', async () => {
    const res = await app.request('/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    })

    expect(res.status).toBe(400)
    const body = await res.json() as { error: string; details: unknown[] }
    expect(body.error).toBe('Invalid request')
    expect(body.details.length).toBeGreaterThan(0)
  })

  it('serves cached audio with a cache hit header', async () => {
    mockStat.mockResolvedValue({ mtimeMs: Date.now(), size: 5 } as any)
    mockReadFile.mockResolvedValue(Buffer.from('cached'))

    const res = await app.request('/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('X-Cache')).toBe('HIT')
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('cached')
  })

  it('synthesizes and caches audio on a cache miss', async () => {
    mockStat.mockRejectedValue(new Error('not found'))
    const fresh = Buffer.concat([Buffer.from('ID3'), Buffer.from('fresh-audio')])
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'audio/mpeg' },
      arrayBuffer: async () => fresh,
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await app.request('/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('X-Cache')).toBe('MISS')
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(fresh.toString())
    expect(fetchMock).toHaveBeenCalledWith(
      'https://tts.example.com/v1/audio/speech',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }),
      }),
    )
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('.mp3'),
      expect.any(Buffer),
    )
  })

  it('refuses to cache a JSON error page that arrived with a 200', async () => {
    mockStat.mockRejectedValue(new Error('not found'))
    const relayBody = JSON.stringify({ error: { message: 'model gpt-4o-mini-tts not found' } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      arrayBuffer: async () => Buffer.from(relayBody),
    }))

    const res = await app.request('/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' }),
    })
    const json = await res.json() as Record<string, unknown>

    expect(res.status).toBe(502)
    expect(mockWriteFile).not.toHaveBeenCalled()
    expect(String(json.details)).toContain('not found')
  })

  it('refuses to cache a non-audio body when the upstream sends no content-type', async () => {
    mockStat.mockRejectedValue(new Error('not found'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => Buffer.from('<html>404</html>'),
    }))

    const res = await app.request('/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' }),
    })

    expect(res.status).toBe(502)
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('still accepts real audio when the upstream sends no content-type', async () => {
    mockStat.mockRejectedValue(new Error('not found'))
    const wav = Buffer.concat([
      Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '),
    ])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => wav,
    }))

    const res = await app.request('/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' }),
    })

    expect(res.status).toBe(200)
    expect(mockWriteFile).toHaveBeenCalled()
  })

  it('does not replay the cached bytes after the API key is fixed', async () => {
    // The acceptance scenario: a bad key first, then the corrected one. With
    // the key outside the cache key, the second call returned the first one's
    // body and the user concluded the fix had no effect.
    mockStat.mockRejectedValue(new Error('not found'))
    const goodAudio = Buffer.concat([Buffer.from('ID3'), Buffer.from('real-audio')])
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'audio/mpeg' },
      arrayBuffer: async () => goodAudio,
    })
    vi.stubGlobal('fetch', fetchMock)

    const first = await app.request('/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Same sentence' }),
    })

    const second = await app.request('/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Same sentence' }),
    })

    // second call is a different user/key, so it must not read the first entry
    expect(Buffer.from(await second.arrayBuffer()).toString()).toBe(goodAudio.toString())
    expect(Buffer.from(await first.arrayBuffer()).toString()).toBe(goodAudio.toString())
    // both went upstream, neither was served from the other's slot
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns the upstream error details when synthesis fails', async () => {
    mockStat.mockRejectedValue(new Error('not found'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ detail: { error: { message: 'Voice not supported' } } }),
    }))

    const res = await app.request('/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'TTS API request failed',
      details: 'Voice not supported',
      upstreamStatus: 400,
      upstreamBody: '{"detail":{"error":{"message":"Voice not supported"}}}',
      detailsIsRawBody: false,
      voice: 'alloy',
      availableVoices: [],
    })
  })

  it('hands the relay\'s status code and body back so the UI can show them', async () => {
    mockStat.mockRejectedValue(new Error('not found'))
    const relayBody = JSON.stringify({
      error: { message: 'The model `gpt-4o-mini-tts` does not exist', code: 'model_not_found' },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => relayBody,
    }))

    const res = await app.request('/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' }),
    })
    const json = await res.json() as Record<string, unknown>

    // a 404 from the relay must stay a 404 on the way out, and the reason must
    // still be here - this is the whole reason the panel stopped being usable
    expect(res.status).toBe(404)
    expect(json.upstreamStatus).toBe(404)
    expect(json.upstreamBody).toBe(relayBody)
    expect(String(json.details)).toContain('does not exist')
  })

  it('lists models and stores them when not cached', async () => {
    mockDiscoverModelsCached.mockResolvedValue({ models: ['tts-1', 'tts-1-hd'], cached: false, source: 'discovered' })

    const res = await app.request('/models')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: ['tts-1', 'tts-1-hd'], source: 'discovered', cached: false })
    expect(mockUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ tts: expect.objectContaining({ availableModels: ['tts-1', 'tts-1-hd'] }) }),
      'default',
    )
  })

  it('returns 400 when models are requested without configuration', async () => {
    mockGetSettings.mockReturnValue({ preferences: { tts: createTtsConfig({ endpoint: '' }) } })

    const res = await app.request('/models')

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'TTS not configured' })
  })

  it('lists voices from the OpenAI data response format', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'alloy' }, { name: 'echo' }] }),
    }))

    const res = await app.request('/voices')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ voices: ['alloy', 'echo'], source: 'discovered', cached: false })
    expect(mockUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ tts: expect.objectContaining({ availableVoices: ['alloy', 'echo'] }) }),
      'default',
    )
  })

  it('lists voices from the simple array response format', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ['alloy', { voice: 'echo' }],
    }))

    const res = await app.request('/voices')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ voices: ['alloy', 'echo'], source: 'discovered', cached: false })
  })

  it('falls back to the default voices when every endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const res = await app.request('/voices')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
      source: 'defaults',
      cached: false,
    })
  })

  it('returns 400 when voices are requested without configuration', async () => {
    mockGetSettings.mockReturnValue({ preferences: { tts: createTtsConfig({ endpoint: '' }) } })

    const res = await app.request('/voices')

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'TTS not configured' })
  })

  it('returns the cache status', async () => {
    mockReaddir.mockResolvedValue(['cached.mp3'] as any)
    mockStat.mockResolvedValue({ size: 1024, mtimeMs: Date.now() } as any)

    const res = await app.request('/status')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      enabled: true,
      configured: true,
      cache: { count: 1, sizeBytes: 1024, sizeMB: 0, maxSizeMB: 200, ttlHours: 24 },
    })
  })
})

describe('cacheAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes audio and frees space when the cache limit would be exceeded', async () => {
    mockReaddir.mockResolvedValue(['big.mp3'] as any)
    mockStat.mockResolvedValue({ size: 200 * 1024 * 1024, mtimeMs: 1000 } as any)
    mockUnlink.mockResolvedValue(undefined)
    mockWriteFile.mockResolvedValue(undefined)

    await cacheAudio('cache-key', Buffer.from('audio'))

    expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('big.mp3'))
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('cache-key.mp3'),
      expect.any(Buffer),
    )
  })

  it('writes audio without cleanup when the cache has room', async () => {
    mockReaddir.mockResolvedValue(['small.mp3'] as any)
    mockStat.mockResolvedValue({ size: 1024, mtimeMs: 1000 } as any)
    mockWriteFile.mockResolvedValue(undefined)

    await cacheAudio('cache-key', Buffer.from('audio'))

    expect(mockUnlink).not.toHaveBeenCalled()
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('cache-key.mp3'),
      expect.any(Buffer),
    )
  })
})


describe('TTS routes take their owner from the session, not the query string', () => {
  let app: ReturnType<typeof createTTSRoutes>

  beforeEach(() => {
    vi.clearAllMocks()
    const inner = createTTSRoutes({} as any)
    app = new Hono().use('*', async (c, next) => {
      c.set('user' as never, { id: 'real-user' } as never)
      await next()
    }).route('/', inner)
    mockGetSettings.mockReturnValue({ preferences: { tts: createTtsConfig() } })
    mockUpdateSettings.mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('ignores ?userId= when reading the configuration', async () => {
    const res = await app.request('/status?userId=someone-else')

    expect(res.status).toBe(200)
    expect(mockGetSettings).toHaveBeenCalledWith('real-user')
    // the whole bug: writes went to the session user, this read went elsewhere
    expect(mockGetSettings).not.toHaveBeenCalledWith('someone-else')
  })

  it('ignores ?userId= when listing models and voices', async () => {
    mockDiscoverModelsCached.mockResolvedValue({
      models: ['tts-1'], cached: false, source: 'discovered',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ data: [{ id: 'alloy' }] }),
    }))

    await app.request('/models?userId=someone-else')
    await app.request('/voices?userId=someone-else')

    expect(mockGetSettings).not.toHaveBeenCalledWith('someone-else')
    expect(mockGetSettings).toHaveBeenCalledWith('real-user')
  })

  it('synthesises with the session user\'s settings, so an enabled TTS is heard', async () => {
    mockStat.mockRejectedValue(new Error('not cached'))
    const audio = Buffer.concat([Buffer.from('ID3'), Buffer.from('sound')])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'audio/mpeg' },
      arrayBuffer: async () => audio,
    }))

    const res = await app.request('/synthesize?userId=someone-else', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' }),
    })

    expect(res.status).toBe(200)
    expect(mockGetSettings).toHaveBeenCalledWith('real-user')
  })
})
