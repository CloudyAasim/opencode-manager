import { createMiddleware } from 'hono/factory'

/**
 * Conditional GET: let a client ask "is this still the same?" and get a
 * `304 Not Modified` instead of the whole body again.
 *
 * Why this exists: the app polls. The MCP status every 15 seconds, the
 * server health every minute, the pending actions of an active session
 * every 6 seconds - and every one of those polls used to transfer the
 * entire payload, because the API sent no validator and no cache
 * headers, so the browser had nothing to revalidate against and simply
 * downloaded the answer again.
 *
 * The freshness is not traded away for that. `Cache-Control: private,
 * no-cache` means *store it, but check with the server before using it*:
 * every request still goes to the server, and the server still decides.
 * All that changes is the answer - a few dozen bytes instead of the
 * whole body - when the data has not moved. A `max-age` would have been
 * the wrong tool: it would have served stale data for an hour.
 *
 * `private` because the API is per-user: the response must not be kept
 * by a shared cache.
 *
 * The validator is *weak* (`W/"..."`), computed over the uncompressed
 * body. The compressing middleware gzips on the way out, so the bytes on
 * the wire are a different representation of the same thing - which is
 * exactly what a weak validator is for. A strong validator would be a
 * lie here, and a client comparing representations could cache the
 * wrong one.
 */
export const CONDITIONAL_GET_CACHE_CONTROL = 'private, no-cache'

/**
 * How much of a response is read to compute its validator.
 *
 * A body bigger than this is sent as it is, with no validator: hashing
 * it costs time and memory, and the saving would be smaller than the
 * cost. The limit also keeps this middleware from being the thing that
 * pushes a memory-starved host over the edge - the host this runs on
 * has 3.9 GB of RAM and no swap.
 */
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024

/**
 * Response bodies worth validating.
 *
 * Text and JSON are the ones that are re-fetched and re-read; a file
 * download is not, and `text/event-stream` never ends - reading it to
 * compute a hash would hang the response forever.
 */
function isValidatableContentType(contentType: string): boolean {
  if (!contentType) return false
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (type === 'text/event-stream') return false
  return type === 'application/json' || type.endsWith('+json') || type.startsWith('text/')
}

/**
 * Does the client's validator refer to this representation?
 *
 * `If-None-Match` carries a list, and the list may hold weak and strong
 * validators of the same representation - `W/"abc"` and `"abc"` mean the
 * same thing for this purpose, which is why the `W/` prefix is stripped
 * before comparing.
 */
export function etagMatches(ifNoneMatch: string, etag: string): boolean {
  const strip = (value: string) => value.trim().replace(/^W\//, '')
  const target = strip(etag)
  return ifNoneMatch
    .split(',')
    .some((candidate) => {
      const trimmed = candidate.trim()
      if (trimmed === '*') return true
      return strip(trimmed) === target
    })
}

async function weakEtag(body: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', body as unknown as ArrayBuffer)
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return `W/"${hex}"`
}

/**
 * Read a response body, giving up past `maxBytes`.
 *
 * Returns the bytes when the body was small enough, and `null` when it
 * was not - in which case the body has to be handed back untouched, which
 * is what `streamedBody` is for. Reading a body and then dropping it
 * would send an empty response.
 */
async function readBody(
  response: Response,
  maxBytes: number,
): Promise<{ bytes: Uint8Array | null; restore?: () => Response }> {
  const body = response.body
  if (!body) return { bytes: null }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    total += value.byteLength
    if (total > maxBytes) {
      // Too big to be worth a validator. The rest of the stream still has
      // to reach the client, so it is put back together here.
      const restore = () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(value)
              const pump = async () => {
                try {
                  for (;;) {
                    const next = await reader.read()
                    if (next.done) {
                      controller.close()
                      return
                    }
                    controller.enqueue(next.value)
                  }
                } catch (error) {
                  controller.error(error)
                }
              }
              void pump()
            },
            cancel(reason) {
              void reader.cancel(reason)
            },
          }),
          { status: response.status, statusText: response.statusText, headers: response.headers },
        )
      return { bytes: null, restore }
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes }
}

export interface ConditionalGetOptions {
  /** How much of a response is read to compute its validator. */
  maxBodyBytes?: number
  /**
   * Paths that are left alone.
   *
   * The proxies are here because they stream: reading their body to hash
   * it would turn a stream into a buffered download, and the event stream
   * would never end.
   */
  skipPrefixes?: string[]
}

export function createConditionalGetMiddleware(options: ConditionalGetOptions = {}) {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const skipPrefixes = options.skipPrefixes ?? []

  return createMiddleware(async (c, next) => {
    await next()

    const method = c.req.method.toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') return
    if (skipPrefixes.some((prefix) => c.req.path.startsWith(prefix))) return

    const res = c.res
    if (!res || res.status !== 200) return

    const cacheControl = res.headers.get('cache-control') ?? ''
    if (cacheControl.includes('no-store')) return

    // A response that already carries a validator keeps it: the proxy
    // forwards the upstream's, and that one is the stronger check.
    if (res.headers.get('etag')) {
      res.headers.set('Cache-Control', CONDITIONAL_GET_CACHE_CONTROL)
      return
    }

    if (!isValidatableContentType(res.headers.get('content-type') ?? '')) return

    const { bytes, restore } = await readBody(res, maxBodyBytes)
    if (!bytes) {
      if (restore) c.res = restore()
      return
    }

    const etag = await weakEtag(bytes)
    const ifNoneMatch = c.req.header('if-none-match')

    if (ifNoneMatch && etagMatches(ifNoneMatch, etag)) {
      c.res = new Response(null, {
        status: 304,
        statusText: 'Not Modified',
        headers: {
          ETag: etag,
          'Cache-Control': CONDITIONAL_GET_CACHE_CONTROL,
          Vary: 'Accept-Encoding',
        },
      })
      return
    }

    c.res = new Response(bytes as unknown as ArrayBuffer, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    })
    c.res.headers.set('ETag', etag)
    c.res.headers.set('Cache-Control', CONDITIONAL_GET_CACHE_CONTROL)
    c.res.headers.set('Vary', 'Accept-Encoding')
  })
}
