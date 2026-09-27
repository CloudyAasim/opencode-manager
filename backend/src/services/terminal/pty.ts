import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { logger } from '../../utils/logger'

export interface PtySpawnOptions {
  shell: string
  cwd: string
  cols: number
  rows: number
  env?: Record<string, string>
  isolateWorkspace?: string
  sandboxCwd?: string
}

export interface PtyProcess {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(listener: (chunk: string) => void): () => void
  onExit(listener: (code: number | null) => void): () => void
}

export interface PtySpawner {
  available(): boolean
  spawn(options: PtySpawnOptions): PtyProcess
}

const BRIDGE_CANDIDATES = [
  path.resolve(process.cwd(), 'backend/scripts/terminal-pty.py'),
  fileURLToPath(new URL('../../../scripts/terminal-pty.py', import.meta.url)),
]

function resolveBridgePath(): string | null {
  for (const candidate of BRIDGE_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return null
}

export class NodePtySpawner implements PtySpawner {
  private availability: boolean | null = null

  available(): boolean {
    if (this.availability !== null) return this.availability

    if (!resolveBridgePath()) {
      this.availability = false
      return false
    }

    try {
      const result = spawnSync('python3', ['-c', 'import pty, termios, fcntl, select'], { timeout: 5000 })
      this.availability = result.status === 0
    } catch {
      this.availability = false
    }

    if (!this.availability) {
      logger.warn('Web terminal unavailable: python3 with pty support was not found')
    }
    return this.availability
  }

  spawn(options: PtySpawnOptions): PtyProcess {
    const bridge = resolveBridgePath()
    if (!bridge) {
      throw new Error('TERMINAL_BRIDGE_MISSING')
    }

    const child = spawn('python3', [bridge], {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
        OCM_PTY_SHELL: options.shell,
        OCM_PTY_CWD: options.cwd,
        OCM_PTY_COLS: String(options.cols),
        OCM_PTY_ROWS: String(options.rows),
        ...(options.isolateWorkspace ? { OCM_PTY_BIND: options.isolateWorkspace } : {}),
        ...(options.sandboxCwd ? { OCM_PTY_SANDBOX_CWD: options.sandboxCwd } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    })

    return new ChildProcessPty(child)
  }
}

class ChildProcessPty implements PtyProcess {
  private readonly dataListeners = new Set<(chunk: string) => void>()
  private readonly exitListeners = new Set<(code: number | null) => void>()
  private readonly decoder = new TextDecoder('utf-8')
  private exited = false
  private closeSent = false
  private quietStderr = false

  constructor(private readonly child: ChildProcess) {
    const stdout = child.stdout
    const stderr = child.stderr
    const control = child.stdio[3] as NodeJS.WritableStream | null | undefined

    stdout?.on('data', (chunk: Buffer) => {
      const text = this.decoder.decode(chunk, { stream: true })
      if (text) {
        for (const listener of this.dataListeners) listener(text)
      }
    })

    stderr?.on('data', (chunk: Buffer) => {
      if (this.quietStderr) return
      const message = chunk.toString('utf-8').trim()
      if (message) logger.warn(`Terminal PTY bridge: ${message}`)
    })

    control?.on('error', () => {
      this.quietStderr = true
    })

    child.on('error', (error) => {
      logger.error('Terminal PTY process error', error)
      this.finish(null)
    })

    child.on('exit', (code) => {
      const tail = this.decoder.decode()
      if (tail) {
        for (const listener of this.dataListeners) listener(tail)
      }
      this.finish(code)
    })
  }

  write(data: string): void {
    if (this.exited) return
    this.child.stdin?.write(data)
  }

  resize(cols: number, rows: number): void {
    const control = this.child.stdio[3] as NodeJS.WritableStream | null | undefined
    if (!control || this.exited) return
    control.write(`${JSON.stringify({ type: 'resize', cols, rows })}\n`)
  }

  kill(): void {
    if (this.exited) return
    this.sendClose()
    const child = this.child
    const killTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // process already gone
      }
    }, 2000)
    killTimer.unref?.()
  }

  onData(listener: (chunk: string) => void): () => void {
    this.dataListeners.add(listener)
    return () => this.dataListeners.delete(listener)
  }

  onExit(listener: (code: number | null) => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  private sendClose(): void {
    if (this.closeSent) return
    this.closeSent = true
    const control = this.child.stdio[3] as NodeJS.WritableStream | null | undefined
    try {
      control?.write(`${JSON.stringify({ type: 'close' })}\n`)
    } catch {
      // ignore closed pipe
    }
    try {
      this.child.kill('SIGTERM')
    } catch {
      // ignore
    }
  }

  private finish(code: number | null): void {
    if (this.exited) return
    this.exited = true
    for (const listener of this.exitListeners) listener(code)
    this.dataListeners.clear()
    this.exitListeners.clear()
  }
}

export function createPtySpawner(): PtySpawner {
  return new NodePtySpawner()
}
