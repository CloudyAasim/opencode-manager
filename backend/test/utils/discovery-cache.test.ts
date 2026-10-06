import { describe, it, expect } from 'vitest'
import { normalizeToBaseUrl } from '../../src/utils/discovery-cache'

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
