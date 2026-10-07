import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app, BrowserWindow, ipcMain, resetStubs, shell } from '../test/electron-stub.ts'

/**
 * Drives the real main process against a stub electron.
 *
 * This is the layer per-function tests cannot reach. `isAllowedNavigation` can
 * be perfect while nothing ever calls it; `setTarget` on the proxy can work
 * while the IPC handler that exposes it is never registered. Both failures are
 * invisible until a user clicks, and both are caught here.
 */

const servers: http.Server[] = []

/** A throwaway copy of what the app expects to find.
 *
 *  The real `frontend/dist` is a build output that may not exist on a fresh
 *  checkout or in CI, and hard-coding a path from this machine would make these
 *  tests pass or fail for reasons that have nothing to do with the code.
 */
async function makeStaticRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'ocm-desktop-'))
  await writeFile(path.join(root, 'index.html'), '<!doctype html><html><body>app</body></html>')
  return root
}

let staticRoot = ''

async function serve(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

async function settle(ms = 150) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** Import a pristine copy of the main process.
 *
 *  `main.ts` wires itself up at import time, which is precisely what is under
 *  test - so each case needs its own module instance. `vi.resetModules()` plus
 *  a static specifier does that; a cache-busted template specifier does not,
 *  because vite cannot resolve a dynamic specifier it cannot see.
 */
async function bootMainProcess() {
  vi.resetModules()
  await import('./main.ts')
  await settle(250)
}

beforeEach(async () => {
  resetStubs()
  servers.length = 0
  staticRoot = await makeStaticRoot()
  process.env.OCM_SERVER_URL = 'http://127.0.0.1:5551'
  process.env.OCM_STATIC_ROOT = staticRoot
  await bootMainProcess()
})

afterEach(() => {
  process.env.OCM_SERVER_URL = ''
  process.env.OCM_STATIC_ROOT = ''
  while (servers.length) {
    const server = servers.pop()
    if (!server) continue
    server.closeAllConnections?.()
    server.close()
  }
})

describe('主进程启动时会做什么', () => {
  it('会开一个窗口', () => {
    expect(BrowserWindow.instances.length, '没有创建任何窗口').toBe(1)
    expect(app.exitCode, '启动失败退出了').toBeNull()
  })

  it('窗口加载的是代理，不是服务器', async () => {
    const upstream = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"status":"healthy","database":"connected"}')
    })
    await ipcMain.invoke('ocm:set-target', upstream)

    const window = BrowserWindow.instances[0]!
    expect(window.webContents.loadedUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    // The whole point of the proxy: the window's origin is not the server's.
    expect(window.webContents.loadedUrl).not.toContain('127.0.0.1:' + new URL(upstream).port)
  })

  it('窗口配置关掉了页面的 Node 能力', () => {
    const options = BrowserWindow.constructedWith[0] as { webPreferences: Record<string, unknown> }
    expect(options.webPreferences.nodeIntegration).toBe(false)
    expect(options.webPreferences.contextIsolation).toBe(true)
    expect(options.webPreferences.sandbox).toBe(true)
  })

  it('ready-to-show 之前不显示窗口', () => {
    const options = BrowserWindow.constructedWith[0] as { show: boolean }
    expect(options.show).toBe(false)
    const window = BrowserWindow.instances[0]!
    expect(window.shown).toBe(false)
    window.readyToShow()
    expect(window.shown).toBe(true)
  })

  it('代理真的起来了，并且转发请求', async () => {
    const upstream = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"which":"upstream"}')
    })
    await ipcMain.invoke('ocm:set-target', upstream)

    const origin = new URL(BrowserWindow.instances[0]!.webContents.loadedUrl!).origin
    const health = await fetch(`${origin}/api/health`)
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ which: 'upstream' })
  })

  it('应用本身由代理伺服，所以窗口的源上有 index.html', async () => {
    const origin = new URL(BrowserWindow.instances[0]!.webContents.loadedUrl!).origin
    const page = await fetch(`${origin}/`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<!doctype html>')
    // Not the SPA fallback of a 404 - the shell is actually being served.
    expect(page.headers.get('content-type')).toContain('text/html')
  })
})

describe('导航限制接上了没有', () => {
  it('同源放行', () => {
    const contents = BrowserWindow.instances[0]!.webContents
    const origin = new URL(contents.loadedUrl!).origin
    expect(contents.tryNavigate(`${origin}/settings/general`)).toBe(true)
  })

  it('别处拦下，并且交给系统浏览器打开', () => {
    const contents = BrowserWindow.instances[0]!.webContents
    // A link in a rendered issue message or an OAuth consent page must not
    // become a navigation in the window that holds the session cookie.
    expect(contents.tryNavigate('https://github.com/CloudyAasim/opencode-manager/issues')).toBe(false)
    expect(shell.opened()).toContain('https://github.com/CloudyAasim/opencode-manager/issues')
  })

  it('本地文件拦下', () => {
    const contents = BrowserWindow.instances[0]!.webContents
    expect(contents.tryNavigate('file:///etc/passwd')).toBe(false)
  })

  it('新窗口一律拒绝（同源也不例外，交给 setWindowOpenHandler 判断）', () => {
    const contents = BrowserWindow.instances[0]!.webContents
    const origin = new URL(contents.loadedUrl!).origin
    expect(contents.open(`${origin}/settings`).action).toBe('allow')
    expect(contents.open('https://example.com/').action).toBe('deny')
  })
})

describe('给渲染进程的 IPC 接口', () => {
  it('两个通道都注册了', () => {
    // A preload that exposes `ocmDesktop.info()` against a channel nobody
    // handles fails at click time, in a packaged app, on a user's machine.
    expect(ipcMain.channels().sort()).toEqual(['ocm:info', 'ocm:set-target'])
  })

  it('info 报出当前目标', async () => {
    const upstream = await serve((_req, res) => {
      res.writeHead(200)
      res.end('{}')
    })
    await ipcMain.invoke('ocm:set-target', upstream)
    const info = (await ipcMain.invoke('ocm:info')) as { target: string; proxyOrigin: string }
    expect(info.target).toBe(upstream)
    expect(info.proxyOrigin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it('切目标成功时回 ok，失败时回原因而不是抛异常', async () => {
    const bad = (await ipcMain.invoke('ocm:set-target', 'not a url')) as {
      ok: boolean
      error: string
    }
    expect(bad.ok).toBe(false)
    expect(bad.error).toMatch(/absolute http/i)

    const wrongType = (await ipcMain.invoke('ocm:set-target', 42)) as { ok: boolean; error: string }
    expect(wrongType.ok).toBe(false)
    expect(wrongType.error).toMatch(/string/i)
  })

  it('坏地址不会把客户端指到不存在的地方', async () => {
    const upstream = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"which":"upstream"}')
    })
    await ipcMain.invoke('ocm:set-target', upstream)
    await ipcMain.invoke('ocm:set-target', '')

    const info = (await ipcMain.invoke('ocm:info')) as { target: string }
    expect(info.target).toBe(upstream)
  })
})

describe('第二个实例', () => {
  it('拿不到单实例锁就退出，不起第二个代理', async () => {
    const first = BrowserWindow.instances.length
    ;(app as unknown as { singleInstance: boolean }).singleInstance = false
    await bootMainProcess()
    // The second run found no lock and quit; it did not open another window on
    // another port with its own idea of which server it serves.
    expect(BrowserWindow.instances.length).toBe(first)
  })
})