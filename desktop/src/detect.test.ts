import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { candidateTargets, detectServer } from './detect.ts'

const openServers: http.Server[] = []

afterEach(async () => {
  while (openServers.length) {
    const server = openServers.pop()
    if (!server) continue
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

async function serve(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler)
  openServers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

const HEALTHY = {
  status: 'healthy',
  database: 'connected',
  opencodeManagerVersion: '0.18.0',
}

describe('找出本机的服务器', () => {
  it('显式配置的地址排在最前', () => {
    const candidates = candidateTargets({ OCM_SERVER_URL: 'https://my.server' } as NodeJS.ProcessEnv)
    expect(candidates[0]).toBe('https://my.server')
  })

  it('没有配置时按约定端口依次尝试，且不重复', () => {
    const candidates = candidateTargets({ OCM_SERVER_PORT: '7000' } as NodeJS.ProcessEnv)
    expect(candidates).toContain('http://localhost:7000')
    // 5551 is the OpenCode server the manager supervises - the one a developer
    // running locally will actually have up, so it is tried before the generic
    // web ports.
    expect(candidates.indexOf('http://localhost:5551')).toBeLessThan(
      candidates.indexOf('http://localhost:3000'),
    )
    expect(new Set(candidates).size).toBe(candidates.length)
  })

  it('认出真正的服务器', async () => {
    const upstream = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(HEALTHY))
    })
    const found = await detectServer([upstream])
    expect(found).toEqual({ url: upstream, version: '0.18.0' })
  })

  it('不被「返回 200 的 HTML」骗过去', async () => {
    // This is the real hazard, not a hypothetical: nginx returns index.html
    // with HTTP 200 for any unknown path, so a wrong port that is merely
    // forwarded to some other app answers 200 with an HTML body. Adopting it
    // would surface much later as a page of JSON decode errors with nothing
    // pointing back at this decision.
    const decoy = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html><html><body>not a server</body></html>')
    })
    expect(await detectServer([decoy])).toBeNull()
  })

  it('不被半对的 JSON 骗过去', async () => {
    const almost = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      // A reverse proxy's own error payload, or an older backend without the
      // version field. Not enough to identify the thing we want.
      res.end(JSON.stringify({ status: 'ok' }))
    })
    expect(await detectServer([almost])).toBeNull()
  })

  it('认得出没有版本号的服务器', async () => {
    const minimal = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'healthy', database: 'connected' }))
    })
    expect(await detectServer([minimal])).toEqual({ url: minimal, version: null })
  })

  it('按顺序取第一个健康的，前面的失败不阻断', async () => {
    const good = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(HEALTHY))
    })
    expect(await detectServer(['http://127.0.0.1:1/', good])).toEqual({
      url: good,
      version: '0.18.0',
    })
  })

  it('服务器不响应时快速跳过，而不是把用户晾在启动画面上', async () => {
    // A port with a firewall in front of it hangs. The difference between
    // "nothing is there" and "something slow is there" is the whole question,
    // so each candidate is abandoned rather than waited on.
    const blackhole = await serve(() => {
      /* never answers */
    })
    const started = Date.now()
    expect(await detectServer([blackhole, 'http://127.0.0.1:2/'])).toBeNull()
    // Generous, because this is a wall-clock assertion: the real budget is
    // 1.2s per candidate, and this only fails if it stops bailing out.
    expect(Date.now() - started).toBeLessThan(4000)
  })

  it('末尾的斜杠不影响判断', async () => {
    const upstream = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(HEALTHY))
    })
    expect((await detectServer([`${upstream}/`]))?.url).toBe(upstream)
  })
})