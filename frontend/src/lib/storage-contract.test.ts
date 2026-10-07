import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setStoredServerUrl } from '@/lib/server-selection'

/**
 * The two storage keys are spelled out here rather than imported, on purpose:
 * they are the on-disk contract. The Electron shell reads the same keys, so a
 * rename that only the frontend notices is a rename that breaks the desktop
 * app silently.
 */
const SERVER_KEY = 'ocm.serverUrl'
const RECENT_KEY = 'ocm.serverUrl.recent'

function installStorage(): Map<string, string> {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)) },
      removeItem: (k: string) => { store.delete(k) },
      clear: () => { store.clear() },
      key: () => null,
      get length() { return store.size },
    },
  })
  return store
}

function rawRecents(store: Map<string, string>): unknown {
  const raw = store.get(RECENT_KEY)
  return raw === undefined ? undefined : JSON.parse(raw)
}

describe('what actually lands on disk', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = installStorage()
  })

  // Read-back normalization hides this: `getStoredServerUrl` normalizes on the
  // way out, so a raw `code.example.com/` still reads back as
  // `https://code.example.com` and every round-trip test passes. The stored
  // bytes are what the Electron shell and any future migration see, so they are
  // asserted directly.
  it('stores the server already normalized', () => {
    setStoredServerUrl('code.example.com/')
    expect(store.get(SERVER_KEY)).toBe('https://code.example.com')

    setStoredServerUrl('https://code.example.com/v1/audio/transcriptions')
    expect(store.get(SERVER_KEY)).toBe('https://code.example.com')
  })

  // The reader filters empty entries out, which is exactly why a write-side
  // regression here is invisible from the outside - and why it matters. Five
  // visits that each pick "same origin" would fill the capped list with empty
  // strings and push every real server out of it.
  it('never writes same origin into the recent list', () => {
    setStoredServerUrl('https://one.example.com')
    setStoredServerUrl('')
    setStoredServerUrl('')
    setStoredServerUrl('')

    expect(rawRecents(store)).toEqual(['https://one.example.com'])
  })

  it('stores the recents capped, newest first, without duplicates', () => {
    for (let i = 0; i < 8; i++) setStoredServerUrl(`https://s${i}.example.com`)
    setStoredServerUrl('https://s2.example.com')

    const recents = rawRecents(store) as string[]
    expect(recents.length).toBeLessThanOrEqual(5)
    expect(recents[0]).toBe('https://s2.example.com')
    expect(new Set(recents).size).toBe(recents.length)
  })

  it('keeps the server and the recents under stable key names', () => {
    setStoredServerUrl('https://one.example.com')
    expect(store.has(SERVER_KEY)).toBe(true)
    expect(store.has(RECENT_KEY)).toBe(true)
  })
})

/**
 * `config/index.ts` is the wiring between the four sources and every one of the
 * ~180 call sites, and it used to have no test at all - so dropping any of the
 * four sources out of it changed nothing observable and every mutation of it
 * survived. Each source is exercised by importing the module fresh, because the
 * module reads all of them once at load time and a test that imports it once
 * only ever sees the first configuration.
 */
describe('the resolved base URL', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = installStorage()
    vi.resetModules()
    delete (window as { __OCM_RUNTIME_CONFIG__?: unknown }).__OCM_RUNTIME_CONFIG__
  })

  async function loadApiBaseUrl(): Promise<string> {
    const mod = await import('@/config')
    return mod.API_BASE_URL
  }

  it('is same origin when nothing is configured anywhere', async () => {
    // The one behaviour every existing deployment depends on. If this returns
    // anything else the session cookie stops being first-party.
    expect(await loadApiBaseUrl()).toBe('')
  })

  it('reads what config.js injected', async () => {
    window.__OCM_RUNTIME_CONFIG__ = { serverUrl: 'code.example.com' }
    expect(await loadApiBaseUrl()).toBe('https://code.example.com')
  })

  it('reads what the person chose', async () => {
    store.set('ocm.serverUrl', 'https://chosen.example.com')
    expect(await loadApiBaseUrl()).toBe('https://chosen.example.com')
  })

  it('prefers the choice over config.js', async () => {
    window.__OCM_RUNTIME_CONFIG__ = { serverUrl: 'https://from-file.example.com' }
    store.set('ocm.serverUrl', 'https://chosen.example.com')
    expect(await loadApiBaseUrl()).toBe('https://chosen.example.com')
  })

  it('falls back to config.js when nothing was chosen', async () => {
    window.__OCM_RUNTIME_CONFIG__ = { serverUrl: 'https://from-file.example.com' }
    expect(await loadApiBaseUrl()).toBe('https://from-file.example.com')
  })

  it('treats an empty config.js as no answer rather than as same origin', async () => {
    // An operator who ships `config.js` with `serverUrl: ""` has said nothing,
    // and the person who later picks a server must still win over it.
    window.__OCM_RUNTIME_CONFIG__ = { serverUrl: '' }
    store.set('ocm.serverUrl', 'https://chosen.example.com')
    expect(await loadApiBaseUrl()).toBe('https://chosen.example.com')
  })

  it('keeps the derived opencode endpoint on the same base', async () => {
    window.__OCM_RUNTIME_CONFIG__ = { serverUrl: 'https://code.example.com' }
    const mod = await import('@/config')
    expect(mod.OPENCODE_API_ENDPOINT).toBe('https://code.example.com/api/opencode')
  })
})