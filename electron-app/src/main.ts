import path from 'node:path'
import { existsSync } from 'node:fs'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { createProxy, InvalidTargetError, type Proxy } from '../../desktop/src/proxy.ts'
import { candidateTargets, detectServer } from '../../desktop/src/detect.ts'
import { appWindowOptions, isAllowedNavigation, loadUrlFor } from './window.ts'

// `__dirname`, not `import.meta.url`: the bundle is CommonJS so that the
// sandboxed preload can be CommonJS too, and esbuild has no honest way to
// synthesise import.meta there.
const here = __dirname

let mainWindow: BrowserWindow | null = null
let proxy: Proxy | null = null
let allowedOrigin = ''

function log(message: string) {
  // stdout is the only thing a packaged app has; there is no console to read
  // unless someone launches it from one.
  process.stdout.write(`[opencode-manager] ${message}\n`)
}

function resolveStaticRoot(): string {
  const candidates = [
    process.env.OCM_STATIC_ROOT,
    // packaged: the app files sit next to the executable
    path.resolve(here, '..', 'frontend', 'dist'),
    // development: this file lives in electron-app/dist
    path.resolve(here, '..', '..', 'frontend', 'dist'),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)

  const found = candidates.find((candidate) => existsSync(path.join(candidate, 'index.html')))
  if (!found) throw new Error(`Built app not found. Looked in:\n  ${candidates.join('\n  ')}`)
  return found
}

async function startProxy(): Promise<void> {
  const staticRoot = resolveStaticRoot()

  let target = process.env.OCM_SERVER_URL?.trim()
  if (!target) {
    log('no server configured; probing this machine')
    const found = await detectServer(candidateTargets())
    if (found) {
      target = found.url
      log(`found ${found.url}${found.version ? ` (v${found.version})` : ''}`)
    } else {
      // Not fatal. The window still opens, the settings screen names a server,
      // and refusing to launch would make "the server is not running yet" look
      // like "the client is broken".
      target = 'http://127.0.0.1:5551'
      log('none found - starting anyway so the server can be chosen in the app')
    }
  }

  proxy = createProxy({ staticRoot, target, secureTransport: false })
  const address = await proxy.listen(0)
  allowedOrigin = `http://${address.host}:${address.port}`
  log(`proxy on ${allowedOrigin} -> ${proxy.getTarget()}`)
}

function wireSecurity(contents: Electron.WebContents) {
  // `will-navigate` covers window.location assignment and link clicks; a target
  // of _blank or window.open goes through the handler below instead.
  contents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url, allowedOrigin)) return
    event.preventDefault()
    log(`blocked navigation to ${url}`)
    // A real browser opens these externally; doing the same here keeps a link
    // in a rendered message from becoming a navigation in a window that holds
    // the session cookie.
    void shell.openExternal(url).catch(() => {})
  })

  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedNavigation(url, allowedOrigin)) return { action: 'allow' }
    void shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })

  contents.on('will-attach-webview', (event) => event.preventDefault())
}

async function createWindow(): Promise<void> {
  if (!proxy) throw new Error('proxy was not started')
  const address = proxy.server.address()
  if (!address || typeof address === 'string') throw new Error('proxy is not listening')

  mainWindow = new BrowserWindow(appWindowOptions())
  wireSecurity(mainWindow.webContents)

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  await mainWindow.loadURL(loadUrlFor(address))
}

function wireIpc() {
  ipcMain.handle('ocm:info', () => ({
    target: proxy?.getTarget() ?? '',
    proxyOrigin: allowedOrigin,
    version: app.getVersion(),
  }))

  ipcMain.handle('ocm:set-target', (_event, target: unknown) => {
    if (typeof target !== 'string') return { ok: false, error: 'target must be a string' }
    try {
      return { ok: true, target: proxy?.setTarget(target) }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof InvalidTargetError ? error.message : String(error),
      }
    }
  })
}

// A second launch should focus the window that is already open, not start a
// second proxy on a second port with its own idea of which server it serves.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(async () => {
    try {
      await startProxy()
      wireIpc()
      await createWindow()

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) void createWindow()
      })
    } catch (error) {
      // There is no window yet to show this in, and a desktop app that quits
      // with no explanation is worse than one that says what went wrong.
      log(`failed to start: ${error instanceof Error ? error.stack : String(error)}`)
      app.exit(1)
    }
  })

  app.on('window-all-closed', () => {
    void proxy?.close()
    app.quit()
  })
}