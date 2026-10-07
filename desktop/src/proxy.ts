import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'
// The subpath, not `@opencode-manager/shared/utils`: that is a barrel of
// extensionless re-exports, which a bundler resolves and node's ESM loader does
// not. Importing it works in the app and throws ERR_MODULE_NOT_FOUND in
// anything node runs directly.
import { normalizeServerUrl } from '@opencode-manager/shared/utils/server-url'
import { buildDownstreamHeaders, buildUpstreamHeaders, targetOrigin } from './proxy-headers.ts'
import { serveStaticFile } from './static-files.ts'

/** Paths the proxy answers itself. Anything under `/api/` is forwarded. */
const CONTROL_PREFIX = '/__ocm/'

export class InvalidTargetError extends Error {
  // Declared rather than as a constructor parameter property: node's type
  // stripping replaces types without transforming code, so `constructor(readonly
  // x: T)` is a syntax error at runtime even though tsc is perfectly happy.
  readonly input: string

  constructor(input: string, reason: string) {
    super(`${reason}: ${JSON.stringify(input)}`)
    this.name = 'InvalidTargetError'
    this.input = input
  }
}

/**
 * `normalizeServerUrl` deliberately never throws - a bad address must not take
 * the app down at startup. But it returns the input trimmed and unchanged when
 * it cannot parse it, and returns `''` for empty, both of which are perfectly
 * fine for a browser ("same origin") and meaningless here. This proxy has to
 * go somewhere; an unparseable target left to `new URL` inside `forward` turns
 * a typo into a 502 with a stack trace, which is exactly the kind of thing that
 * gets reported as "the app is broken" rather than "the address is wrong".
 */
export function toUpstreamUrl(input: string): URL {
  const normalized = normalizeServerUrl(input)
  if (!normalized) {
    throw new InvalidTargetError(input, 'no server address was given')
  }
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new InvalidTargetError(input, 'not an absolute http(s) address')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidTargetError(input, `unsupported scheme ${parsed.protocol}`)
  }
  return parsed
}

export type ProxyOptions = {
  /** Directory holding the built app. Served for every non-API path so the
   *  browser's origin is the proxy, which is what makes requests same-origin
   *  and carries the session cookie. */
  staticRoot: string
  /** Where `/api/*` goes. */
  target: string
  /** Controls `Secure` cookie rewriting. Defaults to false for loopback. */
  secureTransport?: boolean
  onError?: (error: unknown, context: { path: string }) => void
}

export type Proxy = {
  server: http.Server
  getTarget: () => string
  setTarget: (next: string) => string
  listen: (port: number, host?: string) => Promise<{ port: number; host: string }>
  close: () => Promise<void>
}

/**
 * A same-origin proxy between the desktop app and an OpenCode Manager server.
 *
 * Two things make this necessary rather than decorative:
 *
 * **Cookies.** better-auth's session cookie is `SameSite=Lax`. A cross-site
 * XHR does not carry it, so pointing a desktop client straight at a remote
 * server fails every authenticated request with a 401 - and not with a CORS
 * error, because the preflight succeeds and the cookie is dropped silently on
 * the way back. Nothing in the UI says "your session cookie did not travel".
 *
 * **CORS.** The upstream emits no `access-control-allow-origin` for an origin
 * outside `AUTH.TRUSTED_ORIGINS`, and better-auth refuses the request itself.
 *
 * Both disappear when the app is served from the same origin it talks to.
 *
 * Streaming is the part that must not be got wrong. The terminal
 * (`/api/terminal/sessions/:id/stream`) and the event stream (`/api/sse/stream`)
 * are `text/event-stream` that never ends; a proxy that collects the body
 * before responding turns a live terminal into a frozen one, with no error to
 * explain it. So this never touches `res.write` with accumulated data, never
 * ends the response itself, and never sets a response timeout.
 */
export function createProxy(options: ProxyOptions): Proxy {
  const secureTransport = options.secureTransport ?? false
  const { staticRoot, onError } = options
  // Fail at construction rather than on the first request: a desktop app that
  // starts with a bad address should say so while there is still a console.
  let upstreamUrl = toUpstreamUrl(options.target)

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((error) => {
      onError?.(error, { path: req.url ?? '' })
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
      }
      if (!res.writableEnded) {
        res.end(JSON.stringify({ error: 'proxy_failed', message: String(error) }))
      }
    })
  })

  // Defaults are already 0 in modern Node, but an SSE stream that gets cut by
  // a five-minute socket timeout would be the single most confusing failure
  // this proxy could have. Pin it rather than inherit it.
  server.timeout = 0
  server.requestTimeout = 0
  server.headersTimeout = 0
  server.keepAliveTimeout = 72 * 1000

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const requestUrl = req.url ?? '/'

    if (requestUrl.startsWith(CONTROL_PREFIX)) {
      handleControl(req, res, requestUrl)
      return
    }

    if (requestUrl === '/api' || requestUrl.startsWith('/api/')) {
      await forward(req, res, requestUrl)
      return
    }

    const result = await serveStaticFile(staticRoot, requestUrl, res)
    if (!result.served && !res.headersSent) {
      res.writeHead(result.status, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Not found')
    }
  }

  function handleControl(req: http.IncomingMessage, res: http.ServerResponse, requestUrl: string) {
    const json = (status: number, body: unknown) => {
      const payload = JSON.stringify(body)
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
        'cache-control': 'no-store',
      })
      res.end(payload)
    }

    if (req.method === 'GET' && requestUrl === '/__ocm/target') {
      json(200, { target: currentTarget(), secureTransport })
      return
    }

    if (req.method === 'PUT' && requestUrl === '/__ocm/target') {
      let body = ''
      req.setEncoding('utf8')
      req.on('data', (chunk: string) => {
        body += chunk
        if (body.length > 64 * 1024) req.destroy()
      })
      req.on('end', () => {
        let next: unknown
        try {
          next = JSON.parse(body).target
        } catch {
          json(400, { error: 'invalid_json' })
          return
        }
        if (typeof next !== 'string') {
          json(400, { error: 'target_must_be_a_string' })
          return
        }
        try {
          setTarget(next)
        } catch (error) {
          json(400, { error: 'invalid_target', message: String(error) })
          return
        }
        json(200, { target: currentTarget() })
      })
      return
    }

    json(404, { error: 'unknown_control_endpoint' })
  }

  function currentTarget(): string {
    return upstreamUrl.origin + upstreamUrl.pathname.replace(/\/$/, '')
  }

  function setTarget(next: string): string {
    upstreamUrl = toUpstreamUrl(next)
    return currentTarget()
  }

  async function forward(req: http.IncomingMessage, res: http.ServerResponse, requestUrl: string) {
    const parsed = new URL(currentTarget() + requestUrl)
    const origin = targetOrigin(parsed)
    const agent = parsed.protocol === 'https:' ? https : http

    const upstream = agent.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        method: req.method,
        path: `${parsed.pathname}${parsed.search}`,
        headers: buildUpstreamHeaders(req.headers, origin),
      },
      (upstreamRes) => {
        const headers = buildDownstreamHeaders(upstreamRes.headers, origin, { secureTransport })
        headers['x-ocm-proxy-target'] = origin.origin
        res.writeHead(upstreamRes.statusCode ?? 502, headers)

        // Straight pipe, both directions. No buffering anywhere on this path -
        // that is the whole reason `text/event-stream` works through here.
        upstreamRes.pipe(res)
        upstreamRes.on('error', () => res.destroy())
      },
    )

    upstream.on('error', (error) => {
      onError?.(error, { path: requestUrl })
      if (res.headersSent) {
        res.destroy()
        return
      }
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
      res.end(
        JSON.stringify({
          error: 'upstream_unreachable',
          message: `${origin.origin} did not answer`,
        }),
      )
    })

    // A client that goes away mid-stream must not leave the upstream running:
    // an abandoned terminal session would otherwise stay open on the server
    // until its own heartbeat gave up on it.
    const abandon = () => upstream.destroy()
    res.on('close', abandon)
    upstream.on('close', () => res.off('close', abandon))

    // `content-length` is preserved by the header copy, so piping the request
    // body through is enough - multipart uploads and large JSON never land in
    // memory on either side.
    req.on('error', () => upstream.destroy())
    req.pipe(upstream)
  }

  return {
    server,
    getTarget: currentTarget,
    setTarget,
    listen: (port: number, host = '127.0.0.1') =>
      new Promise<{ port: number; host: string }>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => {
          server.off('error', reject)
          const address = server.address()
          if (address && typeof address === 'object') {
            resolve({ port: address.port, host: address.address })
          } else {
            reject(new Error('proxy did not report a listening address'))
          }
        })
      }),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}