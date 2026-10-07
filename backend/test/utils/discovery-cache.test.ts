import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
}))

vi.mock('../../src/utils/fs-safe', () => ({
  mkdirSafe: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getWorkspacePath: () => '/test/workspace',
  ENV: { WORKSPACE: { BASE_PATH: '/test/workspace' } },
}))

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

import {
  normalizeToBaseUrl,
  selectModels,
  discoverModelsCached,
} from '../../src/utils/discovery-cache'

const mockWriteFile = fs.writeFile as any

/**
 * What a self-hosted gateway answers on `/v1/models`: chat models, plus media
 * models carrying the non-standard `relay` block that names the capability.
 * RelayAB is the shape - `asr-1.0`/`audio.stt` and `speech-2.8-hd`/`audio.tts`
 * are its seeded MiniMax models, and the two ids deliberately say nothing about
 * what they do.
 */
const RELAY_MODEL_LIST = {
  object: 'list',
  data: [
    { id: 'gpt-4o', relay: { kind: 'chat' } },
    { id: 'text-embedding-3-large', relay: { kind: 'chat' } },
    { id: 'speech-2.8-hd', relay: { kind: 'media', capability: 'audio.tts' } },
    { id: 'asr-1.0', relay: { kind: 'media', provider: 'minimax', capability: 'audio.stt' } },
    { id: 'gpt-image-1', relay: { kind: 'media', capability: 'image.generate' } },
  ],
}

// The two patterns the TTS and STT routes pass, kept here so this file tests
// the real thing. `asr` and `stt` are the additions; the old STT pattern had
// neither, which is why `asr-1.0` never appeared.
const STT_PATTERN = /whisper|transcri|asr|speech[-_]?to[-_]?text|\bstt\b/
const TTS_PATTERN = /tts|audio|speech/

// The call sites append their own path, so the only thing normalization has to
// guarantee is that base + appended path is the URL the operator meant.
const ttsPath = '/v1/audio/speech'
const sttPath = '/v1/audio/transcriptions'
const modelsPath = '/v1/models'

describe('normalizeToBaseUrl', () => {
  describe('the spellings a relay station documents vs the one the placeholder shows', () => {
    const cases: Array<[label: string, input: string, expected: string]> = [
      ['relay base WITH /v1 (what every relay doc says)', 'https://relay.example.com/v1', 'https://relay.example.com'],
      ['relay base with /v1 + trailing slash', 'https://relay.example.com/v1/', 'https://relay.example.com'],
      ['host only (what the placeholder shows)', 'https://relay.example.com', 'https://relay.example.com'],
      ['host only + trailing slash', 'https://relay.example.com/', 'https://relay.example.com'],
      ['full TTS endpoint pasted', 'https://relay.example.com/v1/audio/speech', 'https://relay.example.com'],
    ]

    it.each(cases)('%s', (_label, input, expected) => {
      expect(normalizeToBaseUrl(input)).toBe(expected)
    })

    // The regression itself: `/v1` used to survive and the path got doubled.
    it('never produces a doubled /v1', () => {
      for (const [, input] of cases) {
        for (const path of [ttsPath, sttPath, modelsPath]) {
          const url = `${normalizeToBaseUrl(input)}${path}`
          expect(url).not.toContain('/v1/v1/')
          expect(url).not.toContain('/v1/v1')
        }
      }
    })
  })

  describe('deeper paths', () => {
    const cases: Array<[label: string, input: string, expected: string]> = [
      ['models endpoint pasted', 'https://relay.example.com/v1/models', 'https://relay.example.com'],
      ['sub-path relay base keeps its sub-path', 'https://gw.example.com/openai/v1', 'https://gw.example.com/openai'],
      ['sub-path relay base without version', 'https://gw.example.com/openai', 'https://gw.example.com/openai'],
      ['versionless sub-path is not mistaken for a version', 'https://gw.example.com/api', 'https://gw.example.com/api'],
      ['openai official base', 'https://api.openai.com/v1', 'https://api.openai.com'],
      ['openai official host', 'https://api.openai.com', 'https://api.openai.com'],
      ['STT endpoint pasted', 'https://relay.example.com/v1/audio/transcriptions', 'https://relay.example.com'],
      ['STT endpoint without version', 'https://relay.example.com/audio/transcriptions', 'https://relay.example.com'],
      ['TTS endpoint without version', 'https://relay.example.com/audio/speech', 'https://relay.example.com'],
      ['voices endpoint pasted', 'https://relay.example.com/v1/audio/voices', 'https://relay.example.com'],
      ['port is preserved', 'http://127.0.0.1:3000/v1', 'http://127.0.0.1:3000'],
      ['a v2 base loses only the version', 'https://relay.example.com/v2', 'https://relay.example.com'],
      ['query string is dropped, not concatenated', 'https://relay.example.com/v1?trace=1', 'https://relay.example.com'],
      ['surrounding whitespace is tolerated', '  https://relay.example.com/v1  ', 'https://relay.example.com'],
    ]

    it.each(cases)('%s', (_label, input, expected) => {
      expect(normalizeToBaseUrl(input)).toBe(expected)
    })
  })

  it('is idempotent - normalizing a base changes nothing', () => {
    const bases = [
      'https://relay.example.com/v1',
      'https://relay.example.com',
      'https://gw.example.com/openai/v1',
      'https://relay.example.com/v1/audio/speech',
    ]

    for (const input of bases) {
      const once = normalizeToBaseUrl(input)
      expect(normalizeToBaseUrl(once)).toBe(once)
    }
  })

  it('keeps the sub-path for a relay that mounts under one', () => {
    expect(`${normalizeToBaseUrl('https://gw.example.com/openai/v1')}${ttsPath}`)
      .toBe('https://gw.example.com/openai/v1/audio/speech')
  })

  it('does not throw on empty or unparseable input', () => {
    expect(normalizeToBaseUrl('')).toBe('')
    expect(normalizeToBaseUrl('   ')).toBe('')
    expect(normalizeToBaseUrl('not a url/v1/')).toBe('not a url/v1')
  })
})

describe('selectModels', () => {
  describe('a gateway that tags its models with a capability', () => {
    it('keeps a model whose name says nothing about what it does', () => {
      expect(selectModels(RELAY_MODEL_LIST, 'audio.stt', STT_PATTERN)).toEqual(['asr-1.0'])
      expect(selectModels(RELAY_MODEL_LIST, 'audio.tts', TTS_PATTERN)).toEqual(['speech-2.8-hd'])
    })

    // The regression, at the level it actually bit: `/whisper|transcri/` is the
    // pattern that shipped, and it cannot see `asr-1.0`.
    it('shows asr-1.0 to the STT picker even under the old narrow pattern', () => {
      expect(selectModels(RELAY_MODEL_LIST, 'audio.stt', /whisper|transcri/)).toEqual(['asr-1.0'])
    })

    it('excludes a model the pattern would have accepted, because the tag says otherwise', () => {
      // `speech` matches the pattern; it is still not a transcription model.
      expect(selectModels(RELAY_MODEL_LIST, 'audio.stt', /speech|tts|audio/)).toEqual(['asr-1.0'])
    })

    it('believes a tag over a matching name in both directions', () => {
      const mislabelled = {
        data: [{ id: 'whisper-large-v3', relay: { capability: 'audio.tts' } }],
      }

      // the name says transcription, the gateway says it is speech
      expect(selectModels(mislabelled, 'audio.stt', /whisper|transcri/)).toEqual([])
      // the name says nothing at all, the gateway says speech
      expect(selectModels(mislabelled, 'audio.tts', TTS_PATTERN)).toEqual(['whisper-large-v3'])
    })

    it('excludes a tagged model that belongs to another capability, whatever the pattern says', () => {
      // Under `/.*/` an untagged chat model survives on the name test - only the
      // tags can hold the image model and the other capability's model out.
      expect(selectModels(RELAY_MODEL_LIST, 'audio.stt', /.*/))
        .toEqual(['gpt-4o', 'text-embedding-3-large', 'asr-1.0'])
      expect(selectModels(RELAY_MODEL_LIST, 'audio.tts', /.*/))
        .toEqual(['gpt-4o', 'text-embedding-3-large', 'speech-2.8-hd'])
    })
  })

  describe('a provider whose list carries no capability tags', () => {
    it('still finds a vendor-named ASR model by its name alone', () => {
      const untagged = { object: 'list', data: [{ id: 'gpt-4o' }, { id: 'asr-1.0' }] }
      expect(selectModels(untagged, 'audio.stt', STT_PATTERN)).toEqual(['asr-1.0'])
    })

    it('still finds the OpenAI transcription names', () => {
      const openai = {
        object: 'list',
        data: [{ id: 'gpt-4o' }, { id: 'whisper-1' }, { id: 'whisper-large-v3' }],
      }
      expect(selectModels(openai, 'audio.stt', STT_PATTERN)).toEqual(['whisper-1', 'whisper-large-v3'])
    })

    it('still keeps a TTS model off the STT picker', () => {
      const untagged = { data: [{ id: 'speech-2.8-hd' }, { id: 'asr-1.0' }] }
      expect(selectModels(untagged, 'audio.stt', STT_PATTERN)).toEqual(['asr-1.0'])
    })
  })

  it('keeps the whole list when no capability is asked for', () => {
    // the OpenCode model picker passes `/.*/` and wants chat models too, so a
    // capability hint that defaults to something would empty its list
    expect(selectModels(RELAY_MODEL_LIST, undefined, /.*/)).toHaveLength(5)
  })

  describe('shapes and rubbish', () => {
    it('reads a bare array of ids, where there are no tags to read', () => {
      expect(selectModels(['whisper-1', 'gpt-4o'], 'audio.stt', STT_PATTERN)).toEqual(['whisper-1'])
    })

    const unusable: Array<[label: string, body: unknown]> = [
      ['null', null],
      ['a bare string', 'error'],
      ['an error envelope', { error: { message: 'nope' } }],
      ['a data field of the wrong type', { data: 'nope' }],
      ['an empty list', { data: [] }],
      ['entries that carry no id', { data: [{ relay: { capability: 'audio.stt' } }] }],
      ['a null entry', { data: [null] }],
    ]

    it.each(unusable)('returns nothing for %s rather than throwing', (_label, body) => {
      expect(selectModels(body, 'audio.stt', STT_PATTERN)).toEqual([])
    })
  })
})

describe('the discovery cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteFile.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => RELAY_MODEL_LIST,
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const cacheFile = (call: number): string => String(mockWriteFile.mock.calls[call]?.[0])

  const opts = {
    baseUrl: 'https://relay.example.com',
    apiKey: 'k',
    type: 'models',
    filterPattern: STT_PATTERN,
    defaultModels: [],
    // forced, so the read path stays out of it and only the write is observed
    forceRefresh: true,
  }

  // TTS and STT both pass `type: 'models'`. With one endpoint and one key that
  // was one cache entry, so the first panel to refresh decided what the second
  // one showed - a speech-to-text list offered to a text-to-speech field.
  it('keeps the two capabilities in separate entries', async () => {
    await discoverModelsCached({ ...opts, capability: 'audio.stt' })
    await discoverModelsCached({ ...opts, capability: 'audio.tts' })

    expect(mockWriteFile).toHaveBeenCalledTimes(2)
    expect(cacheFile(0)).not.toBe(cacheFile(1))
  })

  it('still reuses one entry for repeated lookups of the same capability', async () => {
    await discoverModelsCached({ ...opts, capability: 'audio.stt' })
    await discoverModelsCached({ ...opts, capability: 'audio.stt' })

    expect(cacheFile(0)).toBe(cacheFile(1))
  })

  it('keeps one endpoint from reading another endpoint\'s entry', async () => {
    await discoverModelsCached({ ...opts, capability: 'audio.stt' })
    await discoverModelsCached({ ...opts, baseUrl: 'https://other.example.com', capability: 'audio.stt' })

    expect(cacheFile(0)).not.toBe(cacheFile(1))
  })

  it('reports the provider\'s own models, not the built-in default', async () => {
    const result = await discoverModelsCached({ ...opts, capability: 'audio.stt' })

    expect(result.models).toEqual(['asr-1.0'])
    expect(result.source).toBe('discovered')
  })
})
