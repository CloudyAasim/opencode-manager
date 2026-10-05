import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createTestDb } from '../helpers/assistant-workspace'
import { FakePtySpawner } from '../helpers/fake-pty'
import { safeUserDirectoryName } from '../../src/services/terminal/home'
import { TerminalError, TerminalManager, type TerminalActor } from '../../src/services/terminal/manager'

const { ENV } = vi.hoisted(() => ({
  ENV: {
    AUTH: { TRUST_PROXY: false },
    TERMINAL: {
      ENABLED: true,
      ISOLATE: true,
      SHELL: '/bin/bash',
      CWD: '/workspace',
      USERS_DIR: 'users',
      PER_USER_HOME: true,
      COLS: 100,
      ROWS: 30,
      MAX_SESSIONS_PER_USER: 2,
      MAX_SESSIONS_TOTAL: 3,
      IDLE_TIMEOUT_MS: 900000,
      MAX_DURATION_MS: 28800000,
      ADMINS_ONLY: true,
    },
  },
}))

vi.mock('@opencode-manager/shared/config/env', () => ({ ENV }))
vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const actor: TerminalActor = {
  id: 'user-1',
  email: 'user@example.com',
  username: null,
  role: 'user',
  ipAddress: '203.0.113.5',
  userAgent: 'vitest',
}

function resetEnv() {
  ENV.TERMINAL.ENABLED = true
  ENV.TERMINAL.ISOLATE = true
  ENV.TERMINAL.CWD = '/workspace'
  ENV.TERMINAL.PER_USER_HOME = true
  ENV.TERMINAL.USERS_DIR = 'users'
  ENV.TERMINAL.MAX_SESSIONS_PER_USER = 2
  ENV.TERMINAL.MAX_SESSIONS_TOTAL = 3
}

function captureError(operation: () => unknown): TerminalError {
  try {
    operation()
  } catch (error) {
    expect(error).toBeInstanceOf(TerminalError)
    return error as TerminalError
  }
  throw new Error('expected operation to throw')
}

function firstProcess(spawner: FakePtySpawner) {
  const process = spawner.processes[0]
  if (!process) throw new Error('expected a spawned PTY process')
  return process
}

describe('TerminalManager', () => {
  let db: ReturnType<typeof createTestDb>
  let spawner: FakePtySpawner
  let manager: TerminalManager
  // The tests run against a real per-user home in a temporary directory. The
  // shared fixture used to set PER_USER_HOME false, which - because the old
  // resolver fell back to the workspace root - meant every assertion below was
  // asserting that a non-admin gets bound to everybody's directory. That is the
  // behaviour being removed, so it cannot stay as the baseline.
  let workspaceBase: string
  let userHome: string

  beforeEach(() => {
    resetEnv()
    workspaceBase = mkdtempSync(path.join(tmpdir(), 'ocm-mgr-'))
    ENV.TERMINAL.CWD = workspaceBase
    userHome = path.join(workspaceBase, 'users', safeUserDirectoryName('user-1'))
    db = createTestDb()
    spawner = new FakePtySpawner()
    manager = new TerminalManager(db, spawner)
  })

  afterEach(() => {
    manager.shutdown()
    db.close()
    rmSync(workspaceBase, { recursive: true, force: true })
  })

  it('creates a session with the configured shell and working directory', () => {
    const session = manager.create(actor, { cols: 80, rows: 24 })

    expect(spawner.spawnOptions).toEqual([
      {
        shell: '/bin/bash',
        cwd: userHome,
        cols: 80,
        rows: 24,
        isolateWorkspace: userHome,
        sandboxCwd: '/workspace',
      },
    ])
    expect(session.dimensions).toEqual({ cols: 80, rows: 24 })
    expect(manager.list(actor)).toHaveLength(1)
  })

  it('sandboxes non-admin terminals in the user workspace, not the shared one', () => {
    manager.create(actor, {})

    // The bind source must be this person's directory. The workspace root is
    // the one directory guaranteed to hold every other user's data.
    expect(spawner.spawnOptions[0]?.isolateWorkspace).toBe(userHome)
    expect(spawner.spawnOptions[0]?.isolateWorkspace).not.toBe(workspaceBase)
  })

  it('names the sandbox root the same way the shell will', () => {
    manager.create(actor, {})

    // Inside the chroot the per-user directory is mounted at /workspace, so
    // the path handed to the sandbox has to be expressed in those terms.
    expect(spawner.spawnOptions[0]?.sandboxCwd).toBe('/workspace')
  })

  it('leaves admin terminals unconfined', () => {
    manager.create({ ...actor, role: 'admin' }, {})

    expect(spawner.spawnOptions[0]?.isolateWorkspace).toBeUndefined()
  })

  it('leaves terminals unconfined when isolation is disabled', () => {
    ENV.TERMINAL.ISOLATE = false

    manager.create(actor, {})

    expect(spawner.spawnOptions[0]?.isolateWorkspace).toBeUndefined()
  })

  it('starts a sandboxed terminal in the requested project directory', () => {
    const demo = path.join(userHome, 'repos', 'demo')
    manager.create(actor, { cwd: demo })

    const options = spawner.spawnOptions[0]
    expect(options?.cwd).toBe(demo)
    expect(options?.isolateWorkspace).toBe(userHome)
    expect(options?.sandboxCwd).toBe('/workspace/repos/demo')
  })

  it('falls back to the terminal home when the requested directory is outside it', () => {
    manager.create(actor, { cwd: '/etc' })

    const options = spawner.spawnOptions[0]
    expect(options?.cwd).toBe(userHome)
    expect(options?.sandboxCwd).toBe('/workspace')
  })

  it('refuses to fall back to the shared workspace when there is no per-user home', () => {
    ENV.TERMINAL.PER_USER_HOME = false

    // The old behaviour returned the workspace root here and bound it. There
    // is no directory that holds only this person's files, so the honest answer
    // is that they cannot be given a terminal.
    expect(captureError(() => manager.create(actor, {})).code).toBe('TERMINAL_SANDBOX_UNAVAILABLE')
    expect(spawner.processes).toHaveLength(0)
    expect(spawner.spawnOptions).toHaveLength(0)
  })

  it('still gives an admin a terminal when there is no per-user home', () => {
    ENV.TERMINAL.PER_USER_HOME = false

    // Admins are handed the container on purpose; the missing per-user
    // directory is not their problem and must not become one.
    manager.create({ ...actor, role: 'admin' }, {})

    expect(spawner.processes).toHaveLength(1)
    expect(spawner.spawnOptions[0]?.isolateWorkspace).toBeUndefined()
    expect(spawner.spawnOptions[0]?.cwd).toBe(workspaceBase)
  })

  it('lets an admin start in any workspace directory without a sandbox', () => {
    manager.create({ ...actor, role: 'admin' }, { cwd: path.join(workspaceBase, 'repos', 'demo') })

    const options = spawner.spawnOptions[0]
    expect(options?.cwd).toBe(path.join(workspaceBase, 'repos', 'demo'))
    expect(options?.isolateWorkspace).toBeUndefined()
    expect(options?.sandboxCwd).toBeUndefined()
  })

  it('clamps requested dimensions to the configured defaults on bad input', () => {
    const session = manager.create(actor, { cols: Number.NaN, rows: undefined })

    expect(session.dimensions).toEqual({ cols: 100, rows: 30 })
  })

  it('spawns inside a private per-user directory', () => {
    const session = manager.create(actor, {})

    const options = spawner.spawnOptions[0]
    expect(options?.cwd).toBe(session.cwd)
    expect(session.cwd.startsWith(path.join(workspaceBase, 'users'))).toBe(true)
  })

  it('rejects when the terminal is disabled or unavailable', () => {
    ENV.TERMINAL.ENABLED = false
    expect(captureError(() => manager.create(actor, {})).code).toBe('TERMINAL_DISABLED')
    ENV.TERMINAL.ENABLED = true

    const unavailable = new TerminalManager(db, {
      available: () => false,
      sandboxAvailable: () => false,
      spawn: () => { throw new Error('nope') },
    })
    expect(unavailable.isAvailable()).toBe(false)
    expect(captureError(() => unavailable.create(actor, {})).code).toBe('TERMINAL_UNAVAILABLE')
  })

  it('refuses a non-admin rather than starting a shell with no sandbox', () => {
    const noSandbox = new FakePtySpawner()
    noSandbox.sandboxUsable = false
    const strict = new TerminalManager(db, noSandbox)

    // The whole point of the check: on a host that cannot confine a shell, the
    // answer has to be "no", not "yes, and here is an unrestricted one".
    expect(captureError(() => strict.create(actor, {})).code).toBe('TERMINAL_SANDBOX_UNAVAILABLE')
    expect(noSandbox.processes).toHaveLength(0)
  })

  it('reports the sandbox separately from the runtime being available', () => {
    const noSandbox = new FakePtySpawner()
    noSandbox.sandboxUsable = false
    const strict = new TerminalManager(db, noSandbox)

    // An admin is fine on this host and a non-admin is not. One boolean cannot
    // say that, which is why the config carries two.
    expect(strict.isAvailable()).toBe(true)
    expect(strict.getConfig()).toMatchObject({ available: true, sandboxAvailable: false })
  })

  it('enforces the per-user session limit', () => {
    manager.create(actor, {})
    manager.create(actor, {})

    expect(captureError(() => manager.create(actor, {})).code).toBe('TOO_MANY_SESSIONS')
  })

  it('enforces the global session limit across users', () => {
    const other: TerminalActor = { ...actor, id: 'user-2', email: 'other@example.com' }
    const third: TerminalActor = { ...actor, id: 'user-3', email: 'third@example.com' }

    manager.create(actor, {})
    manager.create(other, {})
    manager.create(third, {})

    expect(captureError(() => manager.create({ ...actor, id: 'user-4' }, {})).code).toBe('TOO_MANY_SESSIONS')
  })

  it('records audit start and end rows', () => {
    const session = manager.create(actor, {})

    const started = db
      .prepare('SELECT user_email, cwd, started_at, ended_at FROM terminal_audit WHERE id = ?')
      .get(session.id) as { user_email: string; cwd: string; started_at: number; ended_at: number | null }
    expect(started.user_email).toBe('user@example.com')
    expect(started.cwd).toBe(userHome)
    expect(started.ended_at).toBeNull()

    firstProcess(spawner).emitExit(0)

    const ended = db
      .prepare('SELECT ended_at, exit_code, close_reason FROM terminal_audit WHERE id = ?')
      .get(session.id) as { ended_at: number; exit_code: number; close_reason: string }
    expect(ended.ended_at).not.toBeNull()
    expect(ended.exit_code).toBe(0)
    expect(ended.close_reason).toBe('process-exited')
  })

  it('rejects access to another user session', () => {
    const session = manager.create(actor, {})
    const intruder: TerminalActor = { ...actor, id: 'user-9', email: 'intruder@example.com' }

    expect(captureError(() => manager.get(session.id, intruder)).code).toBe('FORBIDDEN')
  })

  it('closes all sessions for a user', () => {
    manager.create(actor, {})
    manager.create(actor, {})

    manager.closeAllForUser('user-1', 'session-revoked')

    expect(spawner.processes.every((process) => process.killed)).toBe(true)
  })

  it('reports runtime config', () => {
    expect(manager.getConfig()).toMatchObject({
      enabled: true,
      available: true,
      shell: '/bin/bash',
      cwd: workspaceBase,
      adminsOnly: true,
    })
  })
})
