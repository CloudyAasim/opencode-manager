import { describe, it, expect, beforeEach } from 'vitest'
import {
  getStoredServerUrl,
  setStoredServerUrl,
  clearStoredServerUrl,
  listRecentServerUrls,
} from '@/lib/server-selection'

/**
 * A localStorage that can be made hostile on purpose. Every one of these
 * failures is a browser a real person is using: a private window with storage
 * switched off, a WebView before its origin is ready, a quota already full.
 */
function installStorage(impl: Partial<Storage> | null): void {
  if (impl === null) {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('localStorage is unavailable') },
    })
    return
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: impl,
  })
}

function memoryStorage(): Storage & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
    key: () => null,
    get length() { return store.size },
  } as Storage & { store: Map<string, string> }
}

describe('server selection', () => {
  beforeEach(() => {
    installStorage(memoryStorage())
  })

  it('is unset on a first visit, which means same origin', () => {
    expect(getStoredServerUrl()).toBeNull()
  })

  it('remembers a server the person chose', () => {
    setStoredServerUrl('https://code.example.com')
    expect(getStoredServerUrl()).toBe('https://code.example.com')
  })

  // Typing `code.example.com` and typing `https://code.example.com/` must land
  // on the same stored value, or the settings screen shows the server as unset
  // right after it was saved.
  it('normalizes before it stores, so one server has one stored form', () => {
    setStoredServerUrl('code.example.com/')
    expect(getStoredServerUrl()).toBe('https://code.example.com')

    setStoredServerUrl('  https://code.example.com  ')
    expect(getStoredServerUrl()).toBe('https://code.example.com')

    setStoredServerUrl('https://code.example.com/v1/audio/transcriptions')
    expect(getStoredServerUrl()).toBe('https://code.example.com')
  })

  it('round-trips through storage as the normalized form', () => {
    setStoredServerUrl('code.example.com')
    expect(getStoredServerUrl()).toBe('https://code.example.com')
  })

  // A self-hoster who serves the UI themselves has to be able to say "no
  // server", and that has to survive a reload instead of falling back to
  // whatever was there before.
  it('stores an explicit empty string to mean same origin', () => {
    setStoredServerUrl('https://code.example.com')
    clearStoredServerUrl()
    expect(getStoredServerUrl()).toBeNull()
  })

  describe('recent servers', () => {
    it('remembers what was used before, newest first', () => {
      setStoredServerUrl('https://one.example.com')
      setStoredServerUrl('https://two.example.com')
      setStoredServerUrl('https://three.example.com')

      expect(listRecentServerUrls()).toEqual([
        'https://three.example.com',
        'https://two.example.com',
        'https://one.example.com',
      ])
    })

    // The reason this list exists is that server addresses change. Choosing one
    // twice must not push it down the list and leave duplicates.
    it('moves a repeated server to the front instead of duplicating it', () => {
      setStoredServerUrl('https://one.example.com')
      setStoredServerUrl('https://two.example.com')
      setStoredServerUrl('https://one.example.com')

      expect(listRecentServerUrls()).toEqual([
        'https://one.example.com',
        'https://two.example.com',
      ])
    })

    it('keeps the list short', () => {
      for (let i = 0; i < 9; i++) {
        setStoredServerUrl(`https://s${i}.example.com`)
      }
      const recent = listRecentServerUrls()
      expect(recent.length).toBeLessThanOrEqual(5)
      expect(recent[0]).toBe('https://s8.example.com')
    })

    // Same origin is the absence of a choice, not a server to return to, and
    // going back to it must not wipe what was there before.
    it('never lists same origin, and does not wipe the list by choosing it', () => {
      setStoredServerUrl('https://one.example.com')
      clearStoredServerUrl()
      expect(listRecentServerUrls()).toEqual(['https://one.example.com'])
    })

    it('returns nothing when there is no storage at all', () => {
      installStorage(null)
      expect(listRecentServerUrls()).toEqual([])
    })
  })

  describe('a browser where storage does not work', () => {
    it('reads as unset instead of throwing', () => {
      installStorage(null)
      expect(() => getStoredServerUrl()).not.toThrow()
      expect(getStoredServerUrl()).toBeNull()
    })

    it('still accepts a save without throwing', () => {
      installStorage(null)
      expect(() => setStoredServerUrl('https://code.example.com')).not.toThrow()
    })

    it('survives a storage that throws on write', () => {
      installStorage({
        getItem: () => null,
        setItem: () => { throw new Error('QuotaExceededError') },
        removeItem: () => {},
        clear: () => {},
        key: () => null,
        length: 0,
      })
      expect(() => setStoredServerUrl('https://code.example.com')).not.toThrow()
      expect(listRecentServerUrls()).toEqual([])
    })

    it('survives a storage that throws on read', () => {
      installStorage({
        getItem: () => { throw new Error('SecurityError') },
        setItem: () => {},
        removeItem: () => {},
        clear: () => {},
        key: () => null,
        length: 0,
      })
      expect(getStoredServerUrl()).toBeNull()
    })
  })

  it('ignores a recent list that is not a list of strings', () => {
    installStorage({
      getItem: () => JSON.stringify({ not: 'a list' }),
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    })
    expect(listRecentServerUrls()).toEqual([])
  })

  it('ignores a recent list containing junk entries', () => {
    installStorage({
      getItem: () => JSON.stringify(['https://ok.example.com', 42, null, '   ']),
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    })
    expect(listRecentServerUrls()).toEqual(['https://ok.example.com'])
  })

  it('ignores a recent list that is not valid JSON', () => {
    installStorage({
      getItem: () => '{not json',
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    })
    expect(listRecentServerUrls()).toEqual([])
  })
})