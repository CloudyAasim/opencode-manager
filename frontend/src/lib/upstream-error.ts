export interface UpstreamFailurePayload {
  error?: unknown
  details?: unknown
  upstreamStatus?: unknown
  upstreamBody?: unknown
  detailsIsRawBody?: unknown
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Render a failed TTS/STT call as one line a person can act on.
 *
 * This exists because the old expression was
 * `errorData.error || errorData.details || errorMessage`, and `error` is a
 * constant the backend always sets - so it short-circuited every time and the
 * relay's actual words never reached the screen. Anything that produces a
 * fixed label and no evidence is a failure mode of its own, so the status code
 * is always part of the result and the upstream text is preferred over the
 * label.
 */
export function formatUpstreamFailure(
  payload: UpstreamFailurePayload | null | undefined,
  status: number,
  fallbackLabel: string,
): string {
  const label = asTrimmedString(payload?.error) || fallbackLabel
  const upstreamStatus = Number.isFinite(payload?.upstreamStatus as number)
    ? (payload!.upstreamStatus as number)
    : status

  const details = asTrimmedString(payload?.details)
  const upstreamBody = asTrimmedString(payload?.upstreamBody)
  // details is usually the extracted message; when it is the raw body instead
  // it is the same string as upstreamBody, so only one of them is shown
  const evidence = details && details !== upstreamBody
    ? details
    : details || upstreamBody

  const head = `${label} (HTTP ${upstreamStatus})`
  return evidence && evidence !== label ? `${head}: ${evidence}` : head
}
