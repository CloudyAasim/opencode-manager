/**
 * Finding the server this client should talk to when nobody has named one.
 *
 * The desktop client runs on Windows while the server usually runs inside WSL
 * or a container, so "localhost" is not a fixed answer - it depends on whether
 * the port is forwarded, which process owns it, and whether the server is up
 * at all this morning. So candidates are probed rather than assumed.
 *
 * A probe must answer *quickly*. A port with nothing on it fails immediately;
 * a port with a firewall in front of it hangs. The distinction matters because
 * the difference between "nothing is there" and "something slow is there" is
 * the whole question, and a three-second timeout on each of six ports is
 * eighteen seconds of the user watching a window that has not opened yet.
 */

export type ProbeResult = {
  url: string
  version: string | null
}

const PROBE_TIMEOUT_MS = 1200

/**
 * Ports worth trying, in the order they should win.
 *
 * The explicit env var first because that is the only one that is guaranteed
 * to be the operator's intent. Then the conventional ports, most specific
 * first: 5551 is the OpenCode server the manager supervises, and it is the one
 * a developer running locally will actually have up.
 */
export function candidateTargets(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = env.OCM_SERVER_URL?.trim()
  const candidates: string[] = []
  if (explicit) candidates.push(explicit)

  const ports = [env.OCM_SERVER_PORT, '5551', '3000', '4096', '8080', '5003']
  for (const port of ports) {
    const trimmed = port?.trim()
    if (!trimmed) continue
    // `localhost` rather than 127.0.0.1: WSL forwards both, but a container
    // published to localhost resolves `localhost` through whatever proxy the
    // machine has, and 127.0.0.1 bypasses it. Trying localhost first means the
    // one that works is the one that works on every setup.
    candidates.push(`http://localhost:${trimmed}`)
  }
  return [...new Set(candidates)]
}

/**
 * Probe candidates in order and return the first that identifies itself as an
 * OpenCode Manager server.
 *
 * The health payload is checked rather than just "something answered": any
 * process holding that port - a stray `python -m http.server`, an unrelated
 * dev server - would otherwise be adopted as the server, and the failure would
 * surface much later as a page of JSON decode errors.
 */
export async function detectServer(
  candidates: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeResult | null> {
  for (const base of candidates) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
      let payload: unknown
      try {
        const response = await fetchImpl(`${base.replace(/\/+$/, '')}/api/health`, {
          signal: controller.signal,
        })
        if (!response.ok) continue
        payload = await response.json()
      } finally {
        clearTimeout(timer)
      }

      if (!isHealthPayload(payload)) continue
      return {
        url: base.replace(/\/+$/, ''),
        version: typeof payload.opencodeManagerVersion === 'string' ? payload.opencodeManagerVersion : null,
      }
    } catch {
      // connection refused, DNS failure, timeout - all mean "try the next one"
    }
  }
  return null
}

function isHealthPayload(payload: unknown): payload is Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null) return false
  const record = payload as Record<string, unknown>
  // `status: healthy` is the backend's own word for itself; requiring it means
  // a reverse proxy returning an HTML error page with a 200 cannot pass.
  return record.status === 'healthy' && typeof record.database === 'string'
}