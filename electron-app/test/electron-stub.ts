/**
 * A stand-in for the `electron` module.
 *
 * The main process cannot be launched here - the WSL install has no GTK, and
 * the target is Windows anyway. What can be verified is everything this app
 * actually decides: that the proxy starts, that the window is pointed at the
 * proxy and not the server, that navigation elsewhere is refused, that the IPC
 * handlers are registered and answer.
 *
 * Those are wiring decisions, and wiring is exactly what per-function unit
 * tests cannot see - a perfectly correct `isAllowedNavigation` proves nothing
 * if nothing ever calls it.
 *
 * The state lives on `globalThis` on purpose. `vi.resetModules()` gives the
 * main process a *fresh* copy of this module, so a module-scoped singleton
 * would leave the test inspecting one stub while the app under test drove
 * another - and every assertion would read as "nothing happened". Electron is
 * one object per process; so is this.
 *
 * Deliberately small and deliberately strict: anything the main process does
 * that this stub does not implement is a crash here rather than a surprise in
 * front of a user.
 */
import { EventEmitter } from 'node:events'

type Handler = (event: unknown, ...args: unknown[]) => unknown

type StubState = {
  handlers: Map<string, Handler>
  opened: string[]
  windows: BrowserWindow[]
  windowOptions: unknown[]
  appExitCode: number | null
  singleInstance: boolean
  appEvents: EventEmitter
  appVersion: string
}

const GLOBAL_KEY = '__ocmElectronStub'

function state(): StubState {
  const globals = globalThis as unknown as Record<string, StubState | undefined>
  let existing = globals[GLOBAL_KEY]
  if (!existing) {
    existing = {
      handlers: new Map(),
      opened: [],
      windows: [],
      windowOptions: [],
      appExitCode: null,
      singleInstance: true,
      appEvents: new EventEmitter(),
      appVersion: '0.18.0',
    }
    globals[GLOBAL_KEY] = existing
  }
  return existing
}

export const ipcMain = {
  handle(channel: string, handler: Handler) {
    state().handlers.set(channel, handler)
  },
  /** Drive a handler the way the preload would. */
  async invoke(channel: string, ...args: unknown[]) {
    const handler = state().handlers.get(channel)
    if (!handler) throw new Error(`no handler registered for ${channel}`)
    return handler({}, ...args)
  },
  channels(): string[] {
    return [...state().handlers.keys()]
  },
}

export const shell = {
  async openExternal(url: string) {
    state().opened.push(url)
  },
  opened(): string[] {
    return state().opened
  },
}

export class WebContents extends EventEmitter {
  private openHandler: ((details: { url: string }) => { action: 'allow' | 'deny' }) | null = null
  loadedUrl: string | null = null

  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'allow' | 'deny' }) {
    this.openHandler = handler
  }

  async loadURL(url: string) {
    this.loadedUrl = url
  }

  /** Ask the app's own navigation guard, the way a real navigation would. */
  tryNavigate(url: string): boolean {
    let prevented = false
    this.emit('will-navigate', {
      preventDefault() {
        prevented = true
      },
    }, url)
    return !prevented
  }

  open(url: string) {
    if (!this.openHandler) throw new Error('no window open handler was set')
    return this.openHandler({ url })
  }
}

export class BrowserWindow extends EventEmitter {
  webContents = new WebContents()
  shown = false

  constructor(options: unknown) {
    super()
    state().windows.push(this)
    state().windowOptions.push(options)
  }

  static getAllWindows() {
    return state().windows
  }

  /** Readable from the test without reaching into module internals. */
  static get instances() {
    return state().windows
  }

  /** The options each window was constructed with, in construction order. */
  static get constructedWith() {
    return state().windowOptions
  }

  get isMinimized() {
    return false
  }

  restore() {}
  focus() {}

  show() {
    this.shown = true
  }

  hide() {
    this.shown = false
  }

  /** Real BrowserWindow has this; keeping it off the stub would make the app
   *  look broken when it is the stub that is incomplete. */
  loadURL(url: string) {
    return this.webContents.loadURL(url)
  }

  /** Same shape as the event main.ts waits on before showing. */
  readyToShow() {
    this.emit('ready-to-show')
  }
}

class FakeApp extends EventEmitter {
  get exitCode() {
    return state().appExitCode
  }

  get singleInstance() {
    return state().singleInstance
  }

  set singleInstance(value: boolean) {
    state().singleInstance = value
  }

  whenReady(): Promise<void> {
    return Promise.resolve()
  }

  requestSingleInstanceLock(): boolean {
    return state().singleInstance
  }

  getVersion(): string {
    return state().appVersion
  }

  quit() {}

  exit(code: number) {
    state().appExitCode = code
  }

  on(event: string, listener: (...args: unknown[]) => void): this {
    state().appEvents.on(event, listener)
    return this
  }

  emit(event: string, ...args: unknown[]): boolean {
    return state().appEvents.emit(event, ...args)
  }
}

export const app = new FakeApp()

export function resetStubs() {
  const s = state()
  s.handlers.clear()
  s.opened.length = 0
  s.windows.length = 0
  s.windowOptions.length = 0
  s.appExitCode = null
  s.singleInstance = true
  s.appEvents.removeAllListeners()
}