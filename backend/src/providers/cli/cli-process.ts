import { spawn, type ChildProcess } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import path from 'node:path'

/**
 * The only place in the backend that starts a program.
 *
 * The agent backends that are not servers - a CLI that runs on this machine
 * and leaves its sessions on disk - have to be started somehow, and how they
 * are started differs per agent. Everything except that difference belongs
 * here: finding the program, running it, giving it something on stdin, and
 * stopping it when the user wants the work to stop.
 */

export interface CliEnvironment {
  PATH?: string
  [key: string]: string | undefined
}

export interface CliRunOptions {
  cwd?: string
  input?: string
  timeoutMs?: number
  env?: CliEnvironment
  /** Called with the process as soon as it exists, so that it can be stopped. */
  onSpawn?: (child: ChildProcess) => void
}

export interface CliRunResult {
  code: number | null
  stdout: string
  stderr: string
}

/**
 * The suffixes a program can have on this machine. On Windows a command on
 * the path is usually `foo.exe`, `foo.cmd` or `foo.bat`, and a name without
 * the suffix is what the user would type.
 */
function suffixesFor(platform: NodeJS.Platform): string[] {
  return platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
}

/**
 * Where the program is, or null when it is not on this machine. An agent
 * that is not installed is a normal state, not a failure: the manager runs
 * beside whatever the user has, and it says which agents it can reach.
 */
export function findExecutable(
  name: string,
  environment: CliEnvironment = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const searchPath = environment.PATH ?? ''
  const directories = searchPath.split(path.delimiter).filter(Boolean)

  for (const directory of directories) {
    for (const suffix of suffixesFor(platform)) {
      const candidate = path.join(directory, `${name}${suffix}`)
      try {
        accessSync(candidate, constants.X_OK)
        return candidate
      } catch {
        void 0
      }
    }
  }
  return null
}

/**
 * How a program is started depends on what it is.
 *
 * A program that is installed by a package manager on Windows is a `.cmd` or
 * a `.bat` file, and the runtime refuses to start those without a command
 * interpreter - and a command interpreter means the arguments have to be
 * quoted by hand, because a prompt is an argument and a prompt has spaces
 * and quotes in it.
 */
function shellFor(binary: string, args: string[]): { shell: false; args: string[] } | { command: string; args: string[] } {
  const isWindowsBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(binary)
  if (!isWindowsBatch) return { shell: false, args }
  const command = [binary, ...args].map(quoteForShell).join(' ')
  return { command, args: ['/d', '/s', '/c', `"${command}"`] }
}

/**
 * The quoting a Windows command line needs: a string with a space in it is
 * wrapped in quotes. The command interpreter takes the line as it was
 * written, so the quotes inside it belong to the program that reads them.
 */
export function quoteForShell(argument: string): string {
  if (!/[\s"^&|<>]/.test(argument)) return argument
  return `"${argument.replace(/"/g, '""')}"`
}

export function runCli(
  binary: string,
  args: string[],
  options: CliRunOptions = {},
): Promise<CliRunResult> {
  return new Promise((resolve) => {
    const start = shellFor(binary, args)
    const isBatchFile = 'command' in start

    let child: ChildProcess
    try {
      child = spawn(
        isBatchFile ? (process.env.ComSpec ?? 'cmd.exe') : binary,
        isBatchFile ? start.args : start.args,
        {
          cwd: options.cwd,
          env: { ...process.env, ...options.env } as NodeJS.ProcessEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
          // A command interpreter is given the line as it was written: the
          // runtime would otherwise escape the quotes inside it, and the
          // interpreter would be looking for a file called `"C:\path`.
          ...(isBatchFile ? { windowsVerbatimArguments: true } : {}),
        },
      )
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: error instanceof Error ? error.message : String(error) })
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    options.onSpawn?.(child)

    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    }

    const timer = setTimeout(() => {
      stopChild(child)
      finish(null)
    }, options.timeoutMs ?? 120_000)

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('error', (error) => {
      stderr += error.message
      finish(null)
    })
    child.on('close', (code) => finish(code))

    if (options.input !== undefined) {
      child.stdin?.end(options.input)
    } else {
      child.stdin?.end()
    }
  })
}

/**
 * Stop a program that is still working. The user asked for it to stop, so the
 * signal has to reach the program itself and not just its launcher.
 */
export function stopChild(child: ChildProcess): void {
  if (child.killed) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
    }
  } catch {
    void 0
  }
}

/**
 * The lines of a JSONL file that are not blank. A file that is being
 * written while it is read may end with a half-written line, and a line
 * that does not parse is a line that is not there.
 */
export function jsonlLines(text: string): unknown[] {
  const records: unknown[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      records.push(JSON.parse(trimmed) as unknown)
    } catch {
      void 0
    }
  }
  return records
}
