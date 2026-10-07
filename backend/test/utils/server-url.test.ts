import { describe, it, expect } from 'vitest'
import {
  normalizeServerUrl,
  resolveServerUrl,
  isSameOriginServer,
  joinServerUrl,
} from '@opencode-manager/shared/utils'

/**
 * Every spelling of one server address that a person can actually produce, and
 * all of them have to reduce to the same string. If they do not, a saved
 * preference stops matching itself on the next launch and the app silently
 * talks to whichever server the compile-time default named.
 */
describe('normalizeServerUrl', () => {
  const sameServer: Array<[label: string, input: string, expected: string]> = [
    ['https, no path', 'https://code.example.com', 'https://code.example.com'],
    ['https, trailing slash', 'https://code.example.com/', 'https://code.example.com'],
    ['many trailing slashes', 'https://code.example.com///', 'https://code.example.com'],
    ['bare host, no scheme', 'code.example.com', 'https://code.example.com'],
    ['bare host with a path', 'code.example.com/opencode-manager', 'https://code.example.com/opencode-manager'],
    ['explicit http is kept', 'http://192.168.1.10:5003', 'http://192.168.1.10:5003'],
    ['explicit port is kept', 'https://code.example.com:8443', 'https://code.example.com:8443'],
    ['a mounted sub-path survives', 'https://host.example.com/manager', 'https://host.example.com/manager'],
    ['a version segment on a mount is not the mount', 'https://host.example.com/openai/v1', 'https://host.example.com/openai'],
    ['a trailing sub-path slash is dropped', 'https://host.example.com/manager/', 'https://host.example.com/manager'],
    ['surrounding whitespace', '  https://code.example.com  ', 'https://code.example.com'],
    ['a query string is dropped', 'https://code.example.com/?trace=1', 'https://code.example.com'],
    ['a fragment is dropped', 'https://code.example.com/#x', 'https://code.example.com'],
    ['a pasted endpoint reduces to its server', 'https://code.example.com/api/health', 'https://code.example.com'],
    ['a pasted auth callback reduces to its server', 'https://code.example.com/api/auth/callback', 'https://code.example.com'],
    ['a mount that merely starts with api is not eaten', 'https://host.example.com/api-manager', 'https://host.example.com/api-manager'],
    ['a pasted /v1 base reduces to its server', 'https://code.example.com/v1', 'https://code.example.com'],
    ['a pasted transcription endpoint reduces to its server', 'https://code.example.com/v1/audio/transcriptions', 'https://code.example.com'],
  ]

  it.each(sameServer)('normalizes %s', (_label, input, expected) => {
    expect(normalizeServerUrl(input)).toBe(expected)
  })

  it('produces the same base for every spelling of one server', () => {
    const spellings = [
      'https://code.example.com',
      'https://code.example.com/',
      'code.example.com',
      '  code.example.com/  ',
      'https://code.example.com/?trace=1',
    ]

    const results = spellings.map((s) => normalizeServerUrl(s))
    expect(new Set(results).size).toBe(1)
  })

  it('never produces a doubled slash before an absolute path', () => {
    for (const [, input] of sameServer) {
      expect(joinServerUrl(normalizeServerUrl(input), '/api/health')).not.toContain('//api')
    }
  })

  const empty: Array<[label: string, input: string | null | undefined]> = [
    ['empty string', ''],
    ['whitespace only', '   '],
    ['null', null],
    ['undefined', undefined],
  ]

  it.each(empty)('%s means same origin', (_label, input) => {
    expect(normalizeServerUrl(input)).toBe('')
    expect(joinServerUrl(normalizeServerUrl(input), '/api/health')).toBe('/api/health')
  })

  it('hands back something unusable rather than throwing at startup', () => {
    // A malformed address has to surface as a connection the person can fix,
    // not as a blank screen from a throw during module init.
    expect(() => normalizeServerUrl('http://')).not.toThrow()
    expect(() => normalizeServerUrl('://bad')).not.toThrow()
    expect(() => normalizeServerUrl('ftp://files.example.com')).not.toThrow()
  })

  it('does not silently make a non-http address relative', () => {
    // Falling through to '' here would point an ftp:// or file:// paste at the
    // current origin, which looks like it worked.
    expect(normalizeServerUrl('ftp://files.example.com')).not.toBe('')
  })
})

describe('resolveServerUrl', () => {
  it('prefers what the person chose over everything else', () => {
    expect(resolveServerUrl({
      userSelected: 'https://chosen.example.com',
      fromConfigFile: 'https://from-file.example.com',
      fromBuild: 'https://from-build.example.com',
    })).toBe('https://chosen.example.com')
  })

  it('falls back to the shipped config file when nothing was chosen', () => {
    expect(resolveServerUrl({
      userSelected: '',
      fromConfigFile: 'https://from-file.example.com',
      fromBuild: 'https://from-build.example.com',
    })).toBe('https://from-file.example.com')
  })

  it('falls back to the build default last', () => {
    expect(resolveServerUrl({
      fromConfigFile: null,
      fromBuild: 'https://from-build.example.com',
    })).toBe('https://from-build.example.com')
  })

  // The behaviour every existing deployment depends on: with nothing set at
  // all, the client must talk to the origin it was served from, or the session
  // cookie stops being first-party and every authenticated call 401s.
  it('is same origin when nothing is configured anywhere', () => {
    expect(resolveServerUrl({})).toBe('')
    expect(resolveServerUrl({ userSelected: '', fromConfigFile: null, fromBuild: '' })).toBe('')
  })

  // A stale preference must not pin the first-run value forever, or a person
  // who clears their choice can never get back to same origin.
  it('skips an unusable value instead of pinning on it', () => {
    expect(resolveServerUrl({
      userSelected: '   ',
      fromConfigFile: 'https://from-file.example.com',
    })).toBe('https://from-file.example.com')
  })

  it('normalizes whatever the winning source said', () => {
    expect(resolveServerUrl({ userSelected: 'chosen.example.com/' }))
      .toBe('https://chosen.example.com')
  })
})

describe('isSameOriginServer', () => {
  it('is true for same origin, which is what keeps the cookie first-party', () => {
    expect(isSameOriginServer({}, 'https://code.example.com')).toBe(true)
    expect(isSameOriginServer(
      { userSelected: 'https://code.example.com' },
      'https://code.example.com',
    )).toBe(true)
  })

  it('is false when the server is somewhere else', () => {
    expect(isSameOriginServer(
      { userSelected: 'https://other.example.com' },
      'https://code.example.com',
    )).toBe(false)
  })

  // Same host, different scheme or port is a different origin, and a different
  // cookie scope. Treating it as same origin would promise a cookie that the
  // browser will not send.
  it('is false for the same host on another port or scheme', () => {
    expect(isSameOriginServer(
      { userSelected: 'https://code.example.com' },
      'http://code.example.com',
    )).toBe(false)
    expect(isSameOriginServer(
      { userSelected: 'https://code.example.com' },
      'https://code.example.com:8443',
    )).toBe(false)
  })

  it('is false when there is a remote server but no page origin to compare', () => {
    expect(isSameOriginServer({ userSelected: 'https://other.example.com' })).toBe(false)
  })

  it('does not throw on an origin it cannot parse', () => {
    expect(() => isSameOriginServer(
      { userSelected: 'not a url' },
      'also not a url',
    )).not.toThrow()
  })
})

describe('joinServerUrl', () => {
  const cases: Array<[label: string, base: string, path: string, expected: string]> = [
    ['empty base stays relative', '', '/api/health', '/api/health'],
    ['absolute base', 'https://code.example.com', '/api/health', 'https://code.example.com/api/health'],
    ['base with a trailing slash', 'https://code.example.com/', '/api/health', 'https://code.example.com/api/health'],
    ['base with many trailing slashes', 'https://code.example.com///', '/api/health', 'https://code.example.com/api/health'],
    ['a path without a leading slash gains one', 'https://code.example.com', 'api/health', 'https://code.example.com/api/health'],
    ['a mounted sub-path is preserved', 'https://host.example.com/mgr', '/api/health', 'https://host.example.com/mgr/api/health'],
  ]

  it.each(cases)('%s', (_label, base, path, expected) => {
    expect(joinServerUrl(base, path)).toBe(expected)
  })
})