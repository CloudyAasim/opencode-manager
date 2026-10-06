const MAX_UPSTREAM_BODY_CHARS = 500

export interface UpstreamFailure {
  /**
   * Our own label for the class of failure. This is a constant per call site
   * and must never be the only thing the user gets to see - the whole point of
   * this module is that the upstream's own words travel back to the UI.
   */
  error: string
  /**
   * The most human-readable message found in the upstream body, falling back
   * to the raw body. `detailsIsRawBody` says which one it is.
   */
  details: string
  /** The upstream HTTP status, so 401 and 404 are told apart. */
  upstreamStatus: number
  /** The upstream body, truncated. What the relay actually said. */
  upstreamBody: string
  detailsIsRawBody: boolean
}

export function truncateUpstreamBody(
  body: string,
  max: number = MAX_UPSTREAM_BODY_CHARS,
): string {
  const text = body.trim()
  if (text.length <= max) return text
  return `${text.slice(0, max)}… [truncated, ${text.length} chars total]`
}

/**
 * Turn a failed upstream response into a body the UI can actually show.
 *
 * Relays answer in wildly different shapes - `{detail:{error:{message}}}`,
 * `{error:{message}}`, `{message}`, `{error:"..."}` and plain text all turn up
 * - so every message-shaped field is probed rather than one being assumed, and
 * the untouched body is always carried alongside. A relay that answers with an
 * HTML error page is exactly the case where guessing the shape loses the only
 * information there is.
 */
export function describeUpstreamFailure(opts: {
  error: string
  status: number
  body: string
}): UpstreamFailure {
  const upstreamBody = truncateUpstreamBody(opts.body ?? '')

  let details = upstreamBody
  let detailsIsRawBody = true

  try {
    const parsed = JSON.parse(opts.body)
    const candidates = [
      parsed?.detail?.error?.message,
      parsed?.detail?.message,
      parsed?.error?.message,
      parsed?.error,
      parsed?.message,
    ]
    const found = candidates.find(
      (c): c is string => typeof c === 'string' && c.trim().length > 0,
    )
    if (found) {
      details = found.trim()
      detailsIsRawBody = false
    }
  } catch {
    // not JSON - the raw body is the message
  }

  return {
    error: opts.error,
    details,
    upstreamStatus: opts.status,
    upstreamBody,
    detailsIsRawBody,
  }
}
