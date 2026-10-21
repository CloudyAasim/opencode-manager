/**
 * Listening on the port this client used last time.
 *
 * The port is remembered because the page's origin is
 * `http://127.0.0.1:<port>`, and the browser partitions `localStorage` by
 * origin - scheme, host *and* port. A different port is a different origin:
 * the remembered servers are gone and the service worker is registered afresh.
 *
 * When the remembered port has been taken by something else, an ephemeral one
 * is used instead. That is a graceful degradation and not a failure: the app
 * still works, it only costs a re-login, and refusing to start over a port
 * would turn "something else on this machine owns 47831" into "the client is
 * broken". The Android client makes the same trade (`ProxyServer.start`).
 */
import type { Proxy } from './proxy.ts'

export interface ListenResult {
  port: number
  host: string
  /**
   * True when a port the client had used before was not available and
   * another one was used instead.
   *
   * False when no port had been asked for - nothing was lost then, and
   * saying otherwise would make "the client started" sound like "the client
   * lost something".
   */
  ephemeral: boolean
}

function isAddressInUse(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return code === 'EADDRINUSE' || code === 'EACCES'
}

export async function listenOnPreferredPort(proxy: Proxy, preferredPort: number): Promise<ListenResult> {
  if (preferredPort > 0) {
    try {
      const address = await proxy.listen(preferredPort)
      return { ...address, ephemeral: false }
    } catch (error) {
      if (!isAddressInUse(error)) throw error
    }
  }
  const address = await proxy.listen(0)
  return { ...address, ephemeral: preferredPort > 0 }
}
