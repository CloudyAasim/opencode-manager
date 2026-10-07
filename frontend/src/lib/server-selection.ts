/**
 * Which server this browser was told to use.
 *
 * The answer has to be readable **synchronously at module load**, because about
 * a hundred and eighty call sites bake `API_BASE_URL` into a module-level
 * constant the first time their module is imported
 * (`const BASE = \`${API_BASE_URL}/api/terminal\``). Resolving the server from a
 * `fetch` at startup would mean every one of those constants captured an empty
 * base before the answer arrived, so localStorage it is - a browser store that
 * is available the moment a module evaluates.
 *
 * The cost of that choice is that changing the server cannot be done in place:
 * the constants are already built. `setStoredServerUrl` therefore says so, and
 * the settings screen reloads after saving rather than pretending the switch
 * took effect immediately.
 */
import { normalizeServerUrl } from '@opencode-manager/shared/utils'

const STORAGE_KEY = 'ocm.serverUrl'
const RECENT_KEY = 'ocm.serverUrl.recent'
const MAX_RECENT = 5

/**
 * Storage can be unavailable - a private window in some browsers, a WebView
 * before the origin is ready, a server-side render. Every access is therefore
 * guarded, and a failure to remember is not a failure to run.
 */
function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** The server this browser was told to use, or `null` for "same origin". */
export function getStoredServerUrl(): string | null {
  const storage = safeStorage()
  if (!storage) return null
  try {
    return normalizeServerUrl(storage.getItem(STORAGE_KEY)) || null
  } catch {
    return null
  }
}

/**
 * Remember a server. An empty value means "same origin", which is stored as an
 * explicit empty string rather than as a removal: a self-hoster who clears the
 * box to go back to serving the UI themselves has to be able to say so, and
 * have that survive a reload.
 */
export function setStoredServerUrl(value: string): void {
  const storage = safeStorage()
  if (!storage) return
  const normalized = normalizeServerUrl(value)
  try {
    storage.setItem(STORAGE_KEY, normalized)
    rememberRecent(normalized)
  } catch {
    // A full or disabled store must not stop the app from starting.
  }
}

export function clearStoredServerUrl(): void {
  setStoredServerUrl('')
}

/**
 * Servers used before, newest first.
 *
 * This exists because the stated reason for being able to choose a server is
 * that it changes. Remembering the last few is the difference between retyping
 * an address and picking it, and picking is the only thing that survives an
 * address that somebody has since forgotten.
 */
export function listRecentServerUrls(): string[] {
  const storage = safeStorage()
  if (!storage) return []
  try {
    const raw = storage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => normalizeServerUrl(item))
      .filter((item) => item.length > 0)
  } catch {
    return []
  }
}

function rememberRecent(serverUrl: string): void {
  const storage = safeStorage()
  if (!storage) return
  // Same origin is not a server to return to - it is the absence of a choice -
  // so it never enters the list.
  if (!serverUrl) return

  const next = [serverUrl, ...listRecentServerUrls().filter((item) => item !== serverUrl)]
    .slice(0, MAX_RECENT)
  try {
    storage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Ignore: the preference itself is already saved.
  }
}