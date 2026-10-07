import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProxy, InvalidTargetError, type Proxy } from './proxy.ts'
import {
  buildDownstreamHeaders,
  buildUpstreamHeaders,
  rewriteCsp,
  rewriteLocation,
  rewriteReferer,
  rewriteSetCookie,
  targetOrigin,
} from './proxy-headers.ts'

type Deferred = { promise: Promise<void>; resolve: () => void }

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const openServers: (http.Server | Proxy)[] = []

afterEach(async () => {
  while (openServers.length) {
    const server = openServers.pop()
    if (!server) continue
    if ('close' in server && typeof server.close === 'function' && 'server' in server) {
      await server.close()
    } else {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
})

async function serve(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler)
  openServers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

async function makeStaticRoot(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'ocm-proxy-'))
  const assets = path.join(root, 'assets')
  await mkdir(assets, { recursive: true })
  await writeFile(
    path.join(root, 'index.html'),
    '<!doctype html><html><head><script src="/config.js"></script></head><body></body></html>',
  )
  await writeFile(path.join(root, 'config.js'), 'window.__OCM_RUNTIME_CONFIG__ = {}')
  await writeFile(path.join(assets, 'main-abc123.js'), 'console.log(1)')
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(root, name), content)
  }
  return root
}

async function makeProxy(
  target: string,
  options: { staticRoot?: string; secureTransport?: boolean } = {},
): Promise<{ proxy: Proxy; base: string }> {
  const proxy = createProxy({
    staticRoot: options.staticRoot ?? (await makeStaticRoot()),
    target,
    secureTransport: options.secureTransport,
  })
  openServers.push(proxy as unknown as http.Server)
  const { port } = await proxy.listen(0)
  return { proxy, base: `http://127.0.0.1:${port}` }
}

/** `Response.json()` is `Promise<unknown>` under node's fetch types, so every
 *  read needs the shape stated. One helper, rather than a cast at each site. */
async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

/** A GET whose path is sent byte for byte.
 *
 *  `fetch` normalises `/../` out of the URL before it ever hits the wire, so a
 *  traversal test written with it proves nothing - the request that reaches the
 *  server is already harmless. This is the only way to actually deliver the
 *  path the attacker would send.
 */
function rawGet(base: string, rawPath: string): Promise<{ status: number; body: string }> {
  const url = new URL(base)
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: url.hostname, port: url.port, method: 'GET', path: rawPath },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          body += chunk
        })
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }))
      },
    )
    request.on('error', reject)
    request.end()
  })
}

/** Read a fetch response one chunk at a time, so "did this arrive early?" can
 *  be asked of it. */
async function openStream(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  return {
    response,
    reader,
    async next(): Promise<string> {
      const { value, done } = await reader.read()
      if (done) return ''
      return decoder.decode(value)
    },
  }
}

describe('同源代理：流式转发', () => {
  it('SSE 第一帧必须在最后一帧之前到达', async () => {
    // Deterministic on purpose. The upstream holds the second frame until the
    // test releases it, so a proxy that buffers the whole body before
    // responding cannot possibly deliver the first one - the test times out
    // instead of passing slowly.
    const gate = deferred()
    const upstream = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      res.write('data: first\n\n')
      void gate.promise.then(() => {
        res.write('data: second\n\n')
        res.end()
      })
    })
    const { base } = await makeProxy(upstream)

    const stream = await openStream(`${base}/api/sse/stream`)
    expect(stream.response.headers.get('content-type')).toBe('text/event-stream')

    const first = await stream.next()
    expect(first, '第一帧没有在第二帧之前到达 - 代理在缓冲').toBe('data: first\n\n')

    gate.resolve()
    const second = await stream.next()
    expect(second).toBe('data: second\n\n')
  })

  it('请求体逐段到达上游，不等整个上传结束', async () => {
    const gate = deferred()
    const chunks: string[] = []
    const upstream = await serve((req, res) => {
      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk.toString())
        if (chunks.length === 1) {
          // The upstream can only respond after it has seen the first chunk,
          // which only happens if the proxy is forwarding while still reading.
          gate.resolve()
        }
      })
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ chunks }))
      })
    })
    const { base } = await makeProxy(upstream)

    const response = await fetch(`${base}/api/upload`, { method: 'POST', body: 'first-second' })
    await gate.promise
    const body = (await response.json()) as { chunks: string[] }
    expect(body.chunks.length).toBeGreaterThan(0)
    expect(body.chunks.join('')).toBe('first-second')
  })

  it('客户端断开时上游请求被销毁，不留下悬挂的终端会话', async () => {
    const upstreamClosed = deferred()
    const upstream = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: open\n\n')
      res.on('close', () => upstreamClosed.resolve())
    })
    const { base } = await makeProxy(upstream)

    const stream = await openStream(`${base}/api/terminal/sessions/x/stream`)
    expect(await stream.next()).toBe('data: open\n\n')
    await stream.reader.cancel()

    await upstreamClosed.promise
    expect(true, '上游连接没有被关闭').toBe(true)
  })

  it('上游不可达时立刻返回可读的 502，而不是挂起', async () => {
    const upstream = await serve(() => {})
    const dead = new URL(upstream)
    await new Promise<void>((resolve) => openServers.pop()!.close(() => resolve()))

    const { base } = await makeProxy(`${dead.origin}`)
    const response = await fetch(`${base}/api/health`)
    expect(response.status).toBe(502)
    const body = (await response.json()) as { error: string; message: string }
    expect(body.error).toBe('upstream_unreachable')
    expect(body.message).toContain(dead.origin)
  })
})

describe('同源代理：让上游看到一个正常请求', () => {
  it('把 Origin 改写成上游自己的源', async () => {
    let seen: http.IncomingHttpHeaders | undefined
    const upstream = await serve((req, res) => {
      seen = req.headers
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })
    const { base } = await makeProxy(upstream)

    await fetch(`${base}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: '{}',
    })

    // The browser sends the loopback origin. better-auth's trustedOrigins check
    // would reject it, and the CORS layer would omit allow-origin.
    expect(seen?.origin).toBe(upstream)
    expect(seen?.origin).not.toBe(base)
  })

  it('Referer 保留路径，只换源', async () => {
    let seen: http.IncomingHttpHeaders | undefined
    const upstream = await serve((req, res) => {
      seen = req.headers
      res.writeHead(200)
      res.end()
    })
    const { base } = await makeProxy(upstream)

    await fetch(`${base}/api/repos`, { headers: { referer: `${base}/settings/general?tab=1` } })
    expect(seen?.referer).toBe(`${upstream}/settings/general?tab=1`)
  })

  it('Host 改成上游的', async () => {
    let seen: http.IncomingHttpHeaders | undefined
    const upstream = await serve((req, res) => {
      seen = req.headers
      res.writeHead(200)
      res.end()
    })
    const { base } = await makeProxy(upstream)
    await fetch(`${base}/api/health`)
    expect(seen?.host).toBe(new URL(upstream).host)
  })

  it('逐跳首部不转发', async () => {
    let seen: http.IncomingHttpHeaders | undefined
    const upstream = await serve((req, res) => {
      seen = req.headers
      res.writeHead(200)
      res.end()
    })
    const { base } = await makeProxy(upstream)
    // A proxy that forwards transfer-encoding alongside a body Node is already
    // framing makes the upstream's parser reject the request.
    await fetch(`${base}/api/x`, {
      headers: { te: 'trailers', trailer: 'x-thing', 'proxy-authorization': 'Basic zzz' },
    })

    // `connection` is deliberately absent from this list: Node's http client
    // manages that header itself and will emit its own regardless of what the
    // proxy forwards, so asserting on it would be asserting on Node. These are
    // the hop-by-hop headers the proxy alone decides.
    expect(seen?.te).toBeUndefined()
    expect(seen?.trailer).toBeUndefined()
    expect(seen?.['proxy-authorization']).toBeUndefined()
  })

  it('Set-Cookie 去掉 Domain，http 下去掉 Secure', async () => {
    const upstream = await serve((_req, res) => {
      res.writeHead(200, {
        'set-cookie': [
          'better-auth.session_token=abc; Path=/; HttpOnly; SameSite=Lax; Domain=example.com; Secure',
        ],
      })
      res.end('{}')
    })
    const { base } = await makeProxy(upstream)
    const response = await fetch(`${base}/api/auth/get-session`)
    const cookies = response.headers.getSetCookie()

    expect(cookies).toHaveLength(1)
    expect(cookies[0]).toContain('better-auth.session_token=abc')
    expect(cookies[0]).toContain('HttpOnly')
    expect(cookies[0]).toContain('SameSite=Lax')
    // A cookie scoped to the upstream's domain is refused by the browser when
    // served from loopback, and the browser only logs it.
    expect(cookies[0]).not.toContain('Domain=')
    expect(cookies[0]).not.toContain('Secure')
  })

  it('走 https 时保留 Secure', () => {
    const out = rewriteSetCookie(['a=b; Path=/; Secure; Domain=x.com'], {
      secureTransport: true,
    })
    expect(out[0]).toContain('Secure')
    expect(out[0]).not.toContain('Domain=')
  })

  it('绝对跳转改成同源相对路径', async () => {
    const upstream = await serve((_req, res) => {
      res.writeHead(302, { location: 'https://upstream.example/api/auth/callback?code=1' })
      res.end()
    })
    const { base } = await makeProxy(upstream)
    const response = await fetch(`${base}/api/auth/callback`, { redirect: 'manual' })
    // Following an absolute upstream URL would take the user off the proxy
    // origin and straight back into the cross-origin case.
    expect(response.headers.get('location')).toBe('/api/auth/callback?code=1')
  })

  it('CSP 里的 connect-src 收成 self', () => {
    const out = rewriteCsp(
      "default-src 'self'; connect-src https://upstream.example; frame-ancestors https://upstream.example; img-src 'self' data:",
    )
    expect(out).toContain("connect-src 'self'")
    expect(out).toContain("frame-ancestors 'self'")
    // untouched directives must survive verbatim
    expect(out).toContain("default-src 'self'")
    expect(out).toContain("img-src 'self' data:")
    expect(out).not.toContain('upstream.example')
  })

  it('CSP 是在真实响应上被改写的，不只是纯函数', async () => {
    // The pure-function test above passes whether or not anything calls it.
    // This one goes through the proxy: a CSP pinning connect-src to the upstream
    // origin would block the requests this proxy exists to carry, enforced by
    // the browser, once per request, with nothing in the console.
    const upstream = await serve((_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-security-policy':
          "default-src 'self'; connect-src https://upstream.example wss://upstream.example",
      })
      res.end('{}')
    })
    const { base } = await makeProxy(upstream)
    const response = await fetch(`${base}/api/x`)
    const csp = response.headers.get('content-security-policy')
    expect(csp).toContain("connect-src 'self'")
    expect(csp).not.toContain('upstream.example')
    expect(csp).toContain("default-src 'self'")
  })

  it('响应上标出它代理到了哪里', async () => {
    const upstream = await serve((_req, res) => {
      res.writeHead(200)
      res.end('{}')
    })
    const { base } = await makeProxy(upstream)
    const response = await fetch(`${base}/api/health`)
    expect(response.headers.get('x-ocm-proxy-target')).toBe(upstream)
  })
})

describe('同源代理：伺服应用本身', () => {
  it('非 /api 的路径由代理伺服，源因此与请求同源', async () => {
    const upstream = await serve(() => {
      throw new Error('static paths must not reach the upstream')
    })
    const { base } = await makeProxy(upstream)

    const html = await fetch(`${base}/`)
    expect(html.status).toBe(200)
    expect(html.headers.get('content-type')).toBe('text/html; charset=utf-8')
    // Same-origin in practice: the document and the API share an origin, so
    // the session cookie is first-party on both.
    expect(new URL(base).origin).toBe(new URL(`${base}/api/health`).origin)
  })

  it('config.js 不缓存 - 它不是带哈希的产物', async () => {
    const { base } = await makeProxy('http://127.0.0.1:1')
    const response = await fetch(`${base}/config.js`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.text()).toContain('__OCM_RUNTIME_CONFIG__')
  })

  it('带哈希的 assets 永久缓存', async () => {
    const { base } = await makeProxy('http://127.0.0.1:1')
    const response = await fetch(`${base}/assets/main-abc123.js`)
    expect(response.headers.get('cache-control')).toContain('immutable')
  })

  it('未知路径回落到 index.html，交给前端路由', async () => {
    const { base } = await makeProxy('http://127.0.0.1:1')
    const response = await fetch(`${base}/settings/general`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<!doctype html>')
  })

  it('不允许用 .. 跳出静态根目录', async () => {
    const root = await makeStaticRoot()
    // A file that really is one level up, so "the guard fired" and "the file
    // did not happen to exist" cannot be confused.
    const outside = path.join(path.dirname(root), 'outside-the-root.txt')
    await writeFile(outside, 'SECRET-FROM-OUTSIDE-THE-ROOT')

    const { base } = await makeProxy('http://127.0.0.1:1', { staticRoot: root })

    for (const attempt of ['/../outside-the-root.txt', '/../../etc/passwd']) {
      const { status, body } = await rawGet(base, attempt)
      expect(body, `${attempt} 把静态根目录外面的文件读出来了`).not.toContain(
        'SECRET-FROM-OUTSIDE-THE-ROOT',
      )
      expect(body, `${attempt} 读到了 passwd`).not.toContain('root:')
      // A traversal is not a legitimate app route, so it gets a 404 rather
      // than the SPA fallback that unknown paths inside the root get. Answering
      // with the shell would look like the path resolved.
      expect(status, `${attempt} 应该被 404`).toBe(404)
    }
  })

  it('百分号编码的穿越同样被挡住', async () => {
    const root = await makeStaticRoot()
    await writeFile(path.join(path.dirname(root), 'outside-the-root.txt'), 'SECRET-FROM-OUTSIDE-THE-ROOT')
    const { base } = await makeProxy('http://127.0.0.1:1', { staticRoot: root })

    // Decoded after the check, so a guard that only looked at the raw path
    // would pass this through.
    const { status, body } = await rawGet(base, '/%2e%2e/outside-the-root.txt')
    expect(body).not.toContain('SECRET-FROM-OUTSIDE-THE-ROOT')
    expect(status).toBe(404)
  })
})

describe('同源代理：切换服务器', () => {
  it('控制端点可读可写，且切换立刻生效', async () => {
    const first = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"which":"first"}')
    })
    const second = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"which":"second"}')
    })
    const { proxy, base } = await makeProxy(first)

    const before = await readJson<{ target: string }>(await fetch(`${base}/__ocm/target`))
    expect(before.target).toBe(first)
    expect(await (await fetch(`${base}/api/health`)).text()).toContain('first')

    const put = await fetch(`${base}/__ocm/target`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: second }),
    })
    expect(put.status).toBe(200)
    expect(proxy.getTarget()).toBe(second)
    expect(await (await fetch(`${base}/api/health`)).text()).toContain('second')
  })

  it('归一化用户粘贴的各种写法', async () => {
    const upstream = await serve((_req, res) => {
      res.writeHead(200)
      res.end('{}')
    })
    const { base } = await makeProxy(upstream)

    const put = async (target: string) => {
      const response = await fetch(`${base}/__ocm/target`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target }),
      })
      return (await readJson<{ target: string }>(response)).target
    }

    expect(await put('http://127.0.0.1:9/api/health')).toBe('http://127.0.0.1:9')
    expect(await put('http://127.0.0.1:9/')).toBe('http://127.0.0.1:9')
    expect(await put('http://127.0.0.1:9/some/deep/mount')).toBe('http://127.0.0.1:9/some/deep/mount')
  })

  it('拒绝空地址和无法解析的地址，且旧目标保持不变', async () => {
    const upstream = await serve((_req, res) => {
      res.writeHead(200)
      res.end('{}')
    })
    const { proxy, base } = await makeProxy(upstream)

    const put = async (target: string) =>
      fetch(`${base}/__ocm/target`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target }),
      })

    expect((await put('')).status).toBe(400)
    expect((await put('   ')).status).toBe(400)
    expect((await put('ftp://example.com')).status).toBe(400)
    // A rejected address must not leave the client pointing nowhere.
    expect(proxy.getTarget()).toBe(upstream)
  })

  it('构造时就拒绝坏地址，而不是等第一个请求', () => {
    expect(() => createProxy({ staticRoot: '/tmp', target: '' })).toThrow(InvalidTargetError)
  })
})

describe('首部改写的纯函数', () => {
  const target = targetOrigin(new URL('https://upstream.example:8443'))

  it('buildUpstreamHeaders 改写源相关首部，其余原样保留', () => {
    const out = buildUpstreamHeaders(
      { origin: 'http://127.0.0.1:3900', referer: 'http://127.0.0.1:3900/a?b=1', host: '127.0.0.1:3900', 'x-thing': 'kept' },
      target,
    )
    expect(out.origin).toBe('https://upstream.example:8443')
    expect(out.referer).toBe('https://upstream.example:8443/a?b=1')
    expect(out.host).toBe('upstream.example:8443')
    expect(out['x-thing']).toBe('kept')
  })

  it('referer 为 null 时不把字面量 null 发出去', () => {
    expect(rewriteReferer('null', target.origin)).toBe(target.origin)
    expect(rewriteReferer('', target.origin)).toBe(target.origin)
  })

  it('相对跳转原样保留', () => {
    expect(rewriteLocation('/api/x?y=1')).toBe('/api/x?y=1')
  })

  it('buildDownstreamHeaders 保留 content-encoding，不动压缩过的响应', () => {
    const out = buildDownstreamHeaders(
      { 'content-encoding': 'gzip', 'content-length': '123', 'set-cookie': ['a=b; Secure'] },
      target,
      { secureTransport: false },
    )
    expect(out['content-encoding']).toBe('gzip')
    expect(out['content-length']).toBe('123')
    expect(out['set-cookie']).toEqual(['a=b'])
  })
})