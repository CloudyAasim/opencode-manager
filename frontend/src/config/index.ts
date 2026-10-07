import { createClientConfig, DEFAULTS, ALLOWED_MIME_TYPES, GIT_PROVIDERS } from '../../../shared/src/config/client'
import { resolveServerUrl } from '@opencode-manager/shared/utils'
import { getStoredServerUrl } from '@/lib/server-selection'

/**
 * Injected by `/config.js`, which sits in front of the bundle so a self-hoster
 * can point a build at their own server by editing one file - no rebuild, no
 * image. See `frontend/public/config.js`.
 */
declare global {
  interface Window {
    __OCM_RUNTIME_CONFIG__?: { serverUrl?: string }
  }
}

const serverUrl = resolveServerUrl({
  // What the person chose, which is also what survives a server moving.
  userSelected: getStoredServerUrl(),
  // What the operator of this deployment put in config.js.
  fromConfigFile: typeof window === 'undefined' ? null : window.__OCM_RUNTIME_CONFIG__?.serverUrl,
  // What the build was made with.
  fromBuild: import.meta.env.VITE_API_URL,
})

const config = createClientConfig({
  // Empty means "the origin this page was served from", which is what a
  // deployment behind its own reverse proxy needs for the session cookie to
  // stay first-party. See `shared/src/utils/server-url.ts`.
  API_BASE_URL: serverUrl,
  VITE_SERVER_PORT: import.meta.env.VITE_SERVER_PORT,
  VITE_OPENCODE_PORT: import.meta.env.VITE_OPENCODE_PORT,
  VITE_MAX_FILE_SIZE_MB: import.meta.env.VITE_MAX_FILE_SIZE_MB,
  VITE_MAX_UPLOAD_SIZE_MB: import.meta.env.VITE_MAX_UPLOAD_SIZE_MB,
})

export const API_BASE_URL = config.API_BASE_URL
export const OPENCODE_API_ENDPOINT = `${config.API_BASE_URL}/api/opencode`
export const SERVER_PORT = config.SERVER_PORT
export const OPENCODE_PORT = config.OPENCODE_PORT
export const FILE_LIMITS = config.FILE_LIMITS

export { DEFAULTS, ALLOWED_MIME_TYPES, GIT_PROVIDERS }
export default config