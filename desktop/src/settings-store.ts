/**
 * What this client remembers between launches.
 *
 * Two things, and both of them are things the person would otherwise have to
 * say again every time they opened the app:
 *
 * - **which server** the client talks to, and
 * - **which port** the local proxy listens on.
 *
 * The port is not a detail. The page's origin is `http://127.0.0.1:<port>`,
 * and the browser partitions `localStorage` by origin - scheme, host *and
 * port*. An ephemeral port therefore means a different origin on every launch:
 * the remembered servers are gone and the service worker is registered afresh.
 * The Android client works the same way round (`ServerPreferences.DEFAULT_PORT`
 * and the same fallback), so the two clients behave alike instead of each
 * inventing its own rule.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { normalizeServerUrl } from '@opencode-manager/shared/utils/server-url'

export interface ClientSettings {
  /** The server the proxy points at. */
  target?: string
  /** The port the proxy listens on, so the next launch has the same origin. */
  port?: number
}

export interface SettingsStore {
  /** What is remembered. A file that is missing, unreadable or nonsense
   *  answers "nothing remembered" rather than throwing: a client that cannot
   *  read its own settings must still start. */
  read: () => ClientSettings
  /** Remember something. Throws when it could not be written - the caller
   *  decides whether that is fatal, and for a target change it is. */
  write: (settings: ClientSettings) => void
}

const SETTINGS_FILE = 'client.json'

/**
 * Where this client's settings live.
 *
 * `OCM_CLIENT_SETTINGS` wins so a second client on the same machine (a
 * portable copy next to the installed one, say) can keep its own.
 */
export function defaultSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.OCM_CLIENT_SETTINGS?.trim()
  if (explicit) return explicit
  return path.join(env.HOME || env.USERPROFILE || '.', '.opencode-manager', SETTINGS_FILE)
}

/**
 * A server address, or null when there is none worth remembering.
 *
 * `normalizeServerUrl` is the same function the frontend and the Android
 * client use, deliberately: "what counts as a server address" must not have
 * three answers in three places, or a client accepts an address the others
 * refuse.
 *
 * It hands back a malformed address unchanged rather than throwing, so the
 * proxy's own rule is applied on top of it: an address the proxy would refuse
 * is not one worth remembering either.
 */
function normalizeTarget(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = normalizeServerUrl(value)
  if (!normalized) return undefined

  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  return normalized
}

export function createSettingsStore(filePath: string): SettingsStore {
  return {
    read: () => {
      let raw: string
      try {
        raw = readFileSync(filePath, 'utf8')
      } catch {
        return {}
      }
      let parsed: unknown
      try {
        // A byte order mark is not JSON. Windows editors add one, and the
        // settings file is a thing a person is allowed to edit - so the mark
        // is taken off rather than letting the whole file be unreadable.
        parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
      } catch {
        // A half-written file is not a reason to refuse to start.
        return {}
      }
      if (!parsed || typeof parsed !== 'object') return {}
      const record = parsed as { target?: unknown; port?: unknown }
      const settings: ClientSettings = {}
      const target = normalizeTarget(record.target)
      if (target) settings.target = target
      if (typeof record.port === 'number' && Number.isInteger(record.port) && record.port > 0 && record.port < 65536) {
        settings.port = record.port
      }
      return settings
    },

    write: (settings: ClientSettings) => {
      const payload: ClientSettings = {}
      const target = normalizeTarget(settings.target)
      if (target) payload.target = target
      if (typeof settings.port === 'number' && Number.isInteger(settings.port) && settings.port > 0 && settings.port < 65536) {
        payload.port = settings.port
      }

      mkdirSync(path.dirname(filePath), { recursive: true })
      // Write beside the file and rename over it: a reader never sees half a
      // document, and a crash mid-write leaves the old one intact.
      const temporary = `${filePath}.tmp`
      writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
      renameSync(temporary, filePath)
    },
  }
}
