import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveBridgePath, resolveSandboxScriptPath } from '../../src/services/terminal/pty'

/**
 * `build_shell_argv` in `terminal-pty.py` decides whether the shell it is about
 * to run is confined to the caller's own workspace.
 *
 * The dangerous version of this function is one that quietly returns a plain
 * shell when the sandbox cannot be set up. Nobody using the terminal can tell
 * the difference - they get a working prompt either way - so the only place
 * this can be decided is here.
 *
 * These tests call the function directly rather than going through a PTY,
 * because a PTY swallows the child's exit code and the refusal is precisely
 * about an exit code.
 */

const EX_CONFIG = 78

const temps: string[] = []

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

/** Loads the bridge from `script` and asks it what it would run. */
function askBridge(script: string, bind: string | null) {
  const env: Record<string, string> = { ...process.env, OCM_PTY_SHELL: '/bin/bash' }
  if (bind) env.OCM_PTY_BIND = bind
  else delete env.OCM_PTY_BIND

  const loader = [
    'import importlib.util, json, sys',
    `spec = importlib.util.spec_from_file_location("bridge", ${JSON.stringify(script)})`,
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'sys.stdout.write(json.dumps(module.build_shell_argv("/bin/bash")))',
  ].join('\n')

  const result = spawnSync('python3', ['-c', loader], { env, encoding: 'utf-8' })
  return {
    status: result.status,
    stderr: result.stderr ?? '',
    argv: result.status === 0 ? JSON.parse(result.stdout) as string[] : null,
  }
}

/** A copy of the bridge with no `terminal-sandbox.sh` sitting next to it. */
function bridgeWithoutSandbox(): string {
  const source = resolveBridgePath()
  if (!source) throw new Error('terminal-pty.py not found')
  const dir = mkdtempSync(path.join(tmpdir(), 'ocm-bridge-'))
  temps.push(dir)
  const copy = path.join(dir, 'terminal-pty.py')
  copyFileSync(source, copy)
  return copy
}

describe('the PTY bridge refuses to run an unconfined shell', () => {
  it('sandboxes a non-admin when the script is present', () => {
    const bridge = resolveBridgePath()
    expect(bridge).not.toBeNull()
    expect(resolveSandboxScriptPath()).not.toBeNull()

    const { status, argv } = askBridge(bridge!, '/tmp/ocm-home')

    expect(status).toBe(0)
    // argv[0] is the whole point: `unshare`, not the shell. The sandbox script
    // is passed by absolute path, so match the tail rather than the name.
    expect(argv![0]).toBe('unshare')
    expect(argv!.some((part) => part.endsWith('terminal-sandbox.sh'))).toBe(true)
    expect(argv).toContain('--map-root-user')
  })

  it('exits instead of degrading when the sandbox script is missing', () => {
    const { status, stderr, argv } = askBridge(bridgeWithoutSandbox(), '/tmp/ocm-home')

    // A plain `[shell, "-i"]` here would hand a non-admin the application
    // directory, the database, the OpenCode credentials and every other
    // user's workspaces.
    expect(argv).toBeNull()
    expect(status).toBe(EX_CONFIG)
    expect(stderr).toMatch(/refusing to start an unisolated shell/)
  })

  it('leaves an admin alone: no bind means a plain shell, which is the point', () => {
    const { status, argv } = askBridge(resolveBridgePath()!, null)

    // Admins are deliberately given the whole container. What must never
    // happen is a *non-admin* arriving here.
    expect(status).toBe(0)
    expect(argv).toEqual(['/bin/bash', '-i'])
  })
})
