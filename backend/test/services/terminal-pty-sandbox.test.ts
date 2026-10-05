import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveBridgePath, resolveSandboxScriptPath, SANDBOX_PROBE_FLAGS } from '../../src/services/terminal/pty'

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
/** sysexits EX_USAGE, which is what the shell script exits with on a bad call. */
const EX_USAGE = 64

const temps: string[] = []

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

/** Loads the bridge from `script` and asks it what it would run. */
function askBridge(script: string, bind: string | null, pathOverride?: string) {
  const env: Record<string, string> = { ...process.env, OCM_PTY_SHELL: '/bin/bash' }
  if (pathOverride) env.PATH = pathOverride
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

/**
 * A PATH that can still start python3 but has no `unshare` on it, which is what
 * an image without util-linux looks like to `shutil.which`.
 */
function pythonWithoutUnshare(): string {
  const found = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf-8' })
  const real = found.stdout?.trim()
  if (!real) throw new Error('python3 not found')

  const dir = mkdtempSync(path.join(tmpdir(), 'ocm-path-'))
  temps.push(dir)
  symlinkSync(real, path.join(dir, 'python3'))
  return dir
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

  it('exits instead of degrading when unshare is missing', () => {
    // util-linux is in the Dockerfile, so this branch is unreachable in the
    // real image - which is exactly why it can rot unnoticed. It is the same
    // fail-closed decision as the missing-script branch above, one condition
    // further down.
    const { status, stderr, argv } = askBridge(
      resolveBridgePath()!,
      '/tmp/ocm-home',
      pythonWithoutUnshare(),
    )

    expect(argv).toBeNull()
    expect(status).toBe(EX_CONFIG)
    expect(stderr).toMatch(/unshare not found.*refusing to start an unisolated shell/s)
  })

  it('leaves an admin alone: no bind means a plain shell, which is the point', () => {
    const { status, argv } = askBridge(resolveBridgePath()!, null)

    // Admins are deliberately given the whole container. What must never
    // happen is a *non-admin* arriving here.
    expect(status).toBe(0)
    expect(argv).toEqual(['/bin/bash', '-i'])
  })
})

/**
 * `NodePtySpawner.sandboxAvailable()` runs its own `unshare` to decide whether
 * to hand a non-admin a terminal at all. It lives in a different file, in a
 * different language, from the argv that decides whether the sandbox actually
 * gets built - and nothing compared them, so the two drifted.
 *
 * The drift cost a working sandbox: the probe omitted `--propagation
 * unchanged`, which makes `unshare --mount` attempt a mount propagation change
 * that the AppArmor docker-default profile refuses. The probe therefore failed
 * on a host where the production sandbox succeeded, and every non-admin was
 * told the sandbox was unavailable while the config that would have fixed it
 * was sitting right there on the app.
 *
 * This test fails if either side changes without the other.
 */
describe('the availability probe and the sandbox it probes cannot drift apart', () => {
  it('runs the same unshare flags the bridge will actually run', () => {
    const { status, argv } = askBridge(resolveBridgePath()!, '/tmp/ocm-home')
    expect(status).toBe(0)

    const separator = argv!.indexOf('--')
    expect(separator).toBeGreaterThan(0)

    // Everything between `unshare` and the `--` that ends the options is what
    // decides whether the kernel and the container policy say yes.
    expect(argv!.slice(1, separator)).toEqual([...SANDBOX_PROBE_FLAGS])
  })

  it('keeps the probe from being stricter than the sandbox', () => {
    const { argv } = askBridge(resolveBridgePath()!, '/tmp/ocm-home')

    // Spelled out as its own assertion because "the probe asks a harder
    // question" is the exact shape of the bug this file exists to prevent:
    // unshare --mount without --propagation tries to make the tree private,
    // and that is the one operation AppArmor docker-default blocks.
    expect(SANDBOX_PROBE_FLAGS).toContain('--propagation')
    expect(argv!.join(' ')).toContain('--propagation unchanged')
  })
})

/**
 * `terminal-sandbox.sh` takes `<shell> <workspace> <sandbox-cwd>` and then
 * `shift 3`s. Called with fewer arguments than that it fails at the `shift`
 * with "can't shift that many" - true, and useless to whoever typed it.
 *
 * The neighbouring guard, for an empty workspace, already says what it wanted
 * and exits 64. This brings the argument count in line with it.
 *
 * These run without `unshare` on purpose: the guard fires before the first
 * mount, so they need neither a user namespace nor a writable /tmp, which is
 * what lets them run in CI and on a developer machine.
 */
describe('the sandbox script rejects a bad invocation instead of half-running', () => {
  it('says what it wanted when given too few arguments', () => {
    const script = resolveSandboxScriptPath()
    expect(script).not.toBeNull()

    const result = spawnSync('/bin/sh', [script!, '/bin/true'], { encoding: 'utf-8' })

    expect(result.status).toBe(EX_USAGE)
    expect(result.stderr).toMatch(/<shell> <workspace> <sandbox-cwd>/)
    expect(result.stderr).toMatch(/got 1 argument/)
  })

  it('still refuses an empty workspace', () => {
    const script = resolveSandboxScriptPath()
    expect(script).not.toBeNull()

    // Three arguments, so the count guard is satisfied and this reaches the
    // check that is actually about the workspace. With two arguments the
    // usage message is the better answer anyway.
    const result = spawnSync('/bin/sh', [script!, '/bin/true', '', '/workspace'], {
      encoding: 'utf-8',
    })

    expect(result.status).toBe(EX_USAGE)
    expect(result.stderr).toMatch(/missing workspace directory/)
  })
})

/**
 * The shell inherits the backend's environment on the way down: `pty.ts` spawns
 * the bridge with `...process.env`, the bridge copies `os.environ`, and
 * `unshare` passes it through. The only place that can be taken back is the
 * script's final exec, which is why the scrub lives there.
 *
 * That makes AUTH_SECRET - better-auth's cookie-signing key, and the key stored
 * secrets are encrypted under - something a normal user could read off their
 * own prompt with `env`. Reading it is the same as being able to mint a session
 * for any account, so this is not disclosure to fix, it is the authentication
 * system.
 *
 * Asserted against the source rather than by running it: the script mounts a
 * tmpfs before it reaches the exec, which needs a user namespace, so the
 * behaviour cannot be exercised in an ordinary test run. A behavioural check on
 * a host with user namespaces confirmed the shell receives only these six
 * variables and none of the sentinel values planted in the parent environment.
 */
describe('the sandboxed shell does not inherit the server environment', () => {
  it('clears the environment on the way to the shell', () => {
    const script = resolveSandboxScriptPath()
    expect(script).not.toBeNull()

    const source = readFileSync(script!, 'utf-8')
    const finalExec = source.trimEnd().split('\n').pop() ?? ''

    expect(finalExec).toMatch(/\benv -i\b/)
    // The variables an interactive shell needs and nothing else.
    for (const name of ['PATH', 'HOME', 'TERM']) {
      expect(finalExec).toContain(`${name}=`)
    }
    // Named individually rather than counted, so deleting one is a failure
    // rather than a different total that still happens to match.
    expect(finalExec).not.toMatch(/AUTH_SECRET|ADMIN_PASSWORD|OPENCODE_SERVER_PASSWORD/)
  })
})
