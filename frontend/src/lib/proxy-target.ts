/**
 * The client proxy in front of this page, if there is one.
 *
 * A desktop client does not let the page talk to the server directly: it
 * serves the page itself and forwards `/api/*` to the server, so that the
 * browser sees one origin and the session cookie travels (better-auth's
 * cookie is `SameSite=Lax`, and a cross-site XHR drops it silently - the
 * request passes the CORS layer and comes back 401, with nothing in the UI
 * saying why).
 *
 * That has one consequence for the page: **the server address is the proxy's
 * business, not the page's.** A page that wrote the address into its own
 * storage (`ocm.serverUrl`) would point its own requests at a remote origin,
 * which is exactly the cross-origin case the proxy exists to remove.
 *
 * So the page asks the proxy what it points at, and tells the proxy when the
 * answer should change. The proxy answers on `/__ocm/target`, which is the
 * same control plane the Android client uses - one contract, two shells.
 */

/** Where a client proxy is pointing. */
export interface ProxyTarget {
  /** The server the proxy forwards to. */
  target: string
  /** Whether the proxy is talking to that server over https. */
  secureTransport?: boolean
}

const TARGET_PATH = '/__ocm/target'

/**
 * The proxy's target, or `null` when this page is not behind one.
 *
 * A plain web deployment answers this path with something else - a 404, or
 * the single-page app's own HTML - so the answer is read as JSON and checked
 * for the shape that only the proxy produces. "Something answered" is not
 * "a proxy answered".
 */
export async function readProxyTarget(fetchImpl: typeof fetch = fetch): Promise<ProxyTarget | null> {
  let response: Response
  try {
    response = await fetchImpl(TARGET_PATH, { cache: 'no-store' })
  } catch {
    return null
  }
  if (!response.ok) return null

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    // The single-page app answers unknown paths with its own HTML, and that
    // is not a proxy.
    return null
  }
  if (!payload || typeof payload !== 'object') return null

  const record = payload as { target?: unknown; secureTransport?: unknown }
  if (typeof record.target !== 'string' || record.target.length === 0) return null
  return {
    target: record.target,
    secureTransport: typeof record.secureTransport === 'boolean' ? record.secureTransport : undefined,
  }
}

/**
 * Ask the proxy to point somewhere else.
 *
 * The proxy remembers the change before it applies it, so a failure here
 * means nothing changed - which is why the reason is handed back rather than
 * swallowed.
 */
export async function writeProxyTarget(
  target: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; target?: string; error?: string }> {
  let response: Response
  try {
    response = await fetchImpl(TARGET_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target }),
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return { ok: false, error: `the proxy answered ${response.status}` }
  }

  const record = (payload ?? {}) as { target?: unknown; error?: unknown; message?: unknown }
  if (!response.ok) {
    const reason = typeof record.message === 'string'
      ? record.message
      : typeof record.error === 'string' ? record.error : `the proxy answered ${response.status}`
    return { ok: false, error: reason }
  }
  return { ok: true, target: typeof record.target === 'string' ? record.target : undefined }
}
