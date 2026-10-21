import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { listenOnPreferredPort } from './listen.ts'
import { createProxy, type Proxy } from './proxy.ts'

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

async function makeProxy(): Promise<Proxy> {
  const proxy = createProxy({ staticRoot: '.', target: 'http://127.0.0.1:65500' })
  openServers.push(proxy)
  return proxy
}

async function occupyPort(): Promise<number> {
  const server = http.createServer((_req, res) => res.end('busy'))
  openServers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return port
}

/** A port nobody is listening on: one that was just given up. */
async function freePort(): Promise<number> {
  const server = http.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

describe('代理监听在哪个端口', () => {
  it('记住的端口没有被占，就用它', async () => {
    const proxy = await makeProxy()
    const port = await freePort()

    const address = await listenOnPreferredPort(proxy, port)

    expect(address.port).toBe(port)
    expect(address.ephemeral).toBe(false)
  })

  it('记住的端口被占了，就换一个，而不是拒绝启动', async () => {
    // The app still works on another port; it only costs a re-login, because
    // the browser treats a new port as a new origin.
    const proxy = await makeProxy()
    const port = await occupyPort()

    const address = await listenOnPreferredPort(proxy, port)

    expect(address.port).not.toBe(port)
    expect(address.ephemeral).toBe(true)
  })

  it('没有记住的端口时，随便一个', async () => {
    const proxy = await makeProxy()

    const address = await listenOnPreferredPort(proxy, 0)

    expect(address.port).toBeGreaterThan(0)
    // Nothing was lost: there was no port to lose. Saying "ephemeral" here
    // would make every first launch sound like a failure.
    expect(address.ephemeral).toBe(false)
  })
})
