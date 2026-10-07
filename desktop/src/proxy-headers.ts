import type { IncomingHttpHeaders } from 'node:http'

/**
 * Headers that describe a single hop and must not be forwarded.
 *
 * RFC 9110 7.6.1. `transfer-encoding` in particular is not merely useless
 * here - forwarding a `chunked` request header alongside a body that Node is
 * already framing produces a response the upstream cannot parse.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/** Request headers that describe the browser's relationship to *this* origin.
 *  Forwarded verbatim they would tell the upstream something false. */
const ORIGIN_REWRITTEN = new Set(['origin', 'referer', 'host'])

export type TargetOrigin = {
  /** `scheme://host[:port]` with no trailing slash. */
  origin: string
  host: string
}

export function targetOrigin(target: URL): TargetOrigin {
  return {
    origin: `${target.protocol}//${target.host}`,
    host: target.host,
  }
}

function isRewrittenOriginHeader(name: string): boolean {
  return ORIGIN_REWRITTEN.has(name)
}

/**
 * Turn a browser request into one the upstream would accept if the browser had
 * gone there directly.
 *
 * The origin rewrite is the whole point of this proxy existing. The app is
 * served from `http://127.0.0.1:<port>`, so from the browser's point of view
 * every request is same-origin and CORS never applies. But the upstream still
 * sees `Origin: http://127.0.0.1:<port>` on every POST, and it has two
 * independent checks that will refuse it:
 *
 *   - the CORS layer, which returns no `access-control-allow-origin` for an
 *     origin outside `AUTH.TRUSTED_ORIGINS`;
 *   - better-auth's own `trustedOrigins`, which rejects the request outright.
 *
 * Rewriting the origin to the upstream's own makes the server see exactly what
 * it would have seen without a proxy in the middle. Not rewriting it is not
 * "a missing CORS header the browser ignores" - the browser is not the one
 * that has to be satisfied here, and `same-origin` in the browser buys the
 * user nothing if the server 403s.
 */
export function buildUpstreamHeaders(
  headers: IncomingHttpHeaders,
  target: TargetOrigin,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}

  for (const [rawName, value] of Object.entries(headers)) {
    if (value === undefined) continue
    const name = rawName.toLowerCase()
    if (HOP_BY_HOP.has(name)) continue

    if (isRewrittenOriginHeader(name)) {
      if (name === 'host') {
        out.host = target.host
      } else if (name === 'origin') {
        // keep the upstream's own scheme/host, discard the loopback address
        const joined = Array.isArray(value) ? value.join(',') : value
        out.origin = joined === 'null' ? target.origin : target.origin
      } else {
        // referer: rewrite the origin, keep path and query, because some
        // handlers read it and a bare origin would be a different URL
        const joined = Array.isArray(value) ? value.join(',') : value
        out.referer = rewriteReferer(joined, target.origin)
      }
      continue
    }

    out[name] = value as string | string[]
  }

  return out
}

export function rewriteReferer(referer: string, targetOrigin: string): string {
  // `null` means the browser suppressed it (policy). Passing that through as a
  // literal string would be worse than dropping it.
  if (referer === 'null' || referer === '') return targetOrigin
  try {
    const parsed = new URL(referer)
    return `${targetOrigin}${parsed.pathname}${parsed.search}`
  } catch {
    return targetOrigin
  }
}

/**
 * Make a cookie the browser will accept on *this* origin.
 *
 * `Domain` has to go regardless: a cookie scoped to the upstream's domain is
 * rejected outright when served from `127.0.0.1`, and the browser logs it
 * rather than reporting it anywhere the app can see.
 *
 * `Secure` is dropped only when this side of the proxy is plain http. The proxy
 * binds to loopback, so the flag would assert a protection that is not there
 * while breaking a cookie that has to work. Over https it is left alone, and
 * leaving it alone matters: stripping it there would quietly downgrade the
 * cookie for a real remote session.
 */
export function rewriteSetCookie(
  cookies: string[],
  options: { secureTransport: boolean },
): string[] {
  return cookies.map((cookie) =>
    cookie
      .split(';')
      .filter((part) => {
        const attribute = part.split('=')[0]?.trim().toLowerCase()
        if (attribute === 'domain') return false
        if (attribute === 'secure' && !options.secureTransport) return false
        return true
      })
      .join(';'),
  )
}

/** Response headers worth passing back, minus the hop-by-hop set. */
export function buildDownstreamHeaders(
  headers: IncomingHttpHeaders,
  target: TargetOrigin,
  options: { secureTransport: boolean },
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}

  for (const [rawName, value] of Object.entries(headers)) {
    if (value === undefined) continue
    const name = rawName.toLowerCase()
    if (HOP_BY_HOP.has(name)) continue

    if (name === 'set-cookie') {
      const list = Array.isArray(value) ? value : [value]
      out['set-cookie'] = rewriteSetCookie(list, options)
      continue
    }

    if (name === 'location') {
      // The upstream may redirect to its own absolute origin. Following that
      // would take the user off the proxy origin and straight back into the
      // cross-origin case this proxy exists to avoid.
      const joined = Array.isArray(value) ? value.join(',') : value
      out.location = rewriteLocation(joined)
      continue
    }

    if (name === 'content-security-policy') {
      // A CSP that pins a connect-src to the upstream origin would block the
      // very requests the proxy exists to carry. Narrow it to 'self'.
      const joined = Array.isArray(value) ? value.join(',') : value
      out['content-security-policy'] = rewriteCsp(joined)
      continue
    }

    out[name] = value as string | string[]
  }

  return out
}

export function rewriteLocation(location: string): string {
  if (location.startsWith('/')) return location
  try {
    const parsed = new URL(location)
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return location
  }
}

const CSP_DIRECTIVES_WITH_URLS = ['connect-src', 'form-action', 'frame-ancestors']

export function rewriteCsp(csp: string): string {
  return csp
    .split(';')
    .map((directive) => {
      const trimmed = directive.trim()
      if (!trimmed) return trimmed
      const [name] = trimmed.split(/\s+/)
      if (!name) return trimmed
      const lower = name.toLowerCase()
      if (!CSP_DIRECTIVES_WITH_URLS.includes(lower)) return trimmed
      return `${lower} 'self'`
    })
    .filter((directive) => directive !== '')
    .join('; ')
}