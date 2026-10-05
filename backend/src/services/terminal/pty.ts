import { ServiceUnavailableError } from '../../utils/errors'
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
  /**
   * Whether a non-admin shell can actually be confined on this host right now.
   *
   * Separate from `available()` because the two failures are not
   * interchangeable: a missing python3 means nobody gets a terminal, while a
   * missing sandbox means admins are fine and every non-admin terminal would
   * die at exec with no explanation.
   */
  sandboxAvailable(): boolean
  spawn(options: PtySpawnOptions): PtyProcess
}

const BRIDGE_CANDIDATES = [
  path.resolve(process.cwd(), 'backend/scripts/terminal-pty.py'),
  fileURLToPath(new URL('../../../scripts/terminal-pty.py', import.meta.url)),
]

const SANDBOX_SCRIPT_CANDIDATES = [
  path.resolve(process.cwd(), 'backend/scripts/terminal-sandbox.sh'),
  fileURLToPath(new URL('../../../scripts/terminal-sandbox.sh', import.meta.url)),
]

/**
 * The namespace flags the PTY bridge runs before the sandbox script, in the
 * order `build_shell_argv` uses them.
 *
 * The probe has to ask the host the *same* question the sandbox asks. When it
 * asked a harder one it reported "unavailable" on hosts where the real sandbox
 * works: `--propagation unchanged` is the difference. Without it `unshare
 * --mount` tries to change mount propagation, which the AppArmor
 * docker-default profile refuses - so the probe failed under
 * `seccomp=unconfined` + default AppArmor while the production argv, which
 * passes `--propagation unchanged` and therefore never makes that change,
 * succeeded.
 *
 * Exported so a test can compare it against the bridge's real argv instead of
 * trusting this comment to stay true.
 */
export const SANDBOX_PROBE_FLAGS = [
  '--user',
  '--map-root-user',
  '--mount',
  '--propagation',
  'unchanged',
] as const

// Exported so the tests resolve the scripts exactly the way this module does.
// A test that looked in its own place could pass while production looked in
// another, which is the same class of bug as testing a copy of the logic.
export function resolveBridgePath(): string | null {
  for (const candidate of BRIDGE_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return null
}

export function resolveSandboxScriptPath(): string | null {
  for (const candidate of SANDBOX_SCRIPT_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return null
}

export class NodePtySpawner implements PtySpawner {
  private availability: boolean | null = null
  private sandboxAvailability: boolean | null = null

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

  sandboxAvailable(): boolean {
    if (this.sandboxAvailability !== null) return this.sandboxAvailability

    if (!resolveBridgePath() || !resolveSandboxScriptPath()) {
      this.sandboxAvailability = false
      return false
    }

    // The sandbox is the namespace built by SANDBOX_PROBE_FLAGS. When the
    // kernel or the container's seccomp/AppArmor policy refuses that, exec
    // fails and the shell never starts - so ask the host once, up front,
    // instead of handing out a terminal that is guaranteed to die.
    let reason = ''
    try {
      const result = spawnSync('unshare', [...SANDBOX_PROBE_FLAGS, '--', 'true'], {
        timeout: 5000,
        encoding: 'utf-8',
      })
      this.sandboxAvailability = result.status === 0
      if (!this.sandboxAvailability) {
        // Two different problems with two different fixes, and the operator
        // should not have to guess which one they have.
        reason = (result.stderr ?? '').trim() || `exit ${result.status}`
      }
    } catch (error) {
      this.sandboxAvailability = false
      reason = error instanceof Error ? error.message : String(error)
    }

    if (!this.sandboxAvailability) {
      // `unshare` missing is a Dockerfile problem; `unshare` present and
      // refused is a container policy problem, and `dokku config` cannot fix
      // the AppArmor half of it.
      const missing = /ENOENT|not found/i.test(reason)
      logger.warn(
        missing
          ? 'Web terminal sandbox unavailable: `unshare` was not found in this image, so a non-admin shell cannot be confined. Install util-linux in the Dockerfile.'
          : `Web terminal sandbox unavailable: a non-admin shell cannot be confined on this host (${reason}). ` +
            'This is a container policy refusing unprivileged user namespaces - the usual cause is the default seccomp profile, ' +
            'in which case add "--security-opt seccomp=unconfined", or the AppArmor docker-default profile, which dokku config cannot change. ' +
            'Unisolated shells are refused rather than served, so this leaves admins unaffected and everybody else without a terminal.',
      )
    }
    return this.sandboxAvailability
  }

  spawn(options: PtySpawnOptions): PtyProcess {
    const bridge = resolveBridgePath()
    if (!bridge) {
      throw new ServiceUnavailableError('TERMINAL_BRIDGE_MISSING')
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
      void 0
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
    void 0
    }
    try {
      this.child.kill('SIGTERM')
    } catch {
    void 0
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
