/**
 * The parts of the window setup that are decisions rather than plumbing.
 *
 * Split out from `main.ts` so they can be tested without a display server.
 * Electron's security defaults are the reason this file exists: the renderer
 * holds a live session cookie for a server that can read and write code on the
 * user's machine, so "what may this window navigate to" is a security boundary,
 * not a detail.
 */

/** Node's own `AddressInfo`, minus the parts that are not needed here.
 *  Shaped to match rather than renamed, so a listener's address can be handed
 *  straight in instead of being mapped and mapped wrong. */
export type ProxyAddress = { address: string; port: number }

/** Where the window loads from.
 *
 *  Always the proxy, never the server. Loading the server's own origin would
 *  put the app back into the cross-origin case the proxy exists to remove, and
 *  would do it in the one place where nobody would notice - it would simply
 *  log in fine on a machine that happens to have a reverse proxy in front.
 */
export function loadUrlFor({ address, port }: ProxyAddress): string {
  const host = address === '::' || address === '0.0.0.0' ? '127.0.0.1' : address
  return `http://${host}:${port}/`
}

/**
 * Whether the window is allowed to navigate to this URL.
 *
 * `will-navigate` fires for anything the page tries to do that is not a
 * subresource load, including `window.location = ...` and a link click. Left
 * unhandled, a link to anywhere - a rendered issue link, an OAuth provider's
 * consent page, a redirect in a server message - replaces the app in a window
 * that still holds the session cookie.
 *
 * The allow-list is the proxy's own origin plus nothing else. `file:` is
 * excluded on purpose: a `file://` document in this window would be able to
 * read local files with the renderer's privileges.
 */
export function isAllowedNavigation(url: string, allowedOrigin: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  return parsed.origin === allowedOrigin
}

export type WindowOptions = {
  width: number
  height: number
  minWidth: number
  minHeight: number
  title: string
  backgroundColor: string
  show: boolean
  webPreferences: {
    /**
     * The renderer gets no Node. It renders an app whose server can run code on
     * this machine; giving the page `require` would turn any injection into
     * local code execution.
     */
    contextIsolation: true
    nodeIntegration: false
    sandbox: true
    /** Nothing needs a native handle. */
    webSecurity: true
  }
}

export function appWindowOptions(): WindowOptions {
  return {
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'OpenCode Manager',
    // The app's own background, so the window does not flash white before the
    // stylesheet lands.
    backgroundColor: '#09090b',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  }
}