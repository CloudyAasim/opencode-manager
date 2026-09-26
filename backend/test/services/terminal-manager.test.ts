import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createTestDb } from '../helpers/assistant-workspace'
import { FakePtySpawner } from '../helpers/fake-pty'
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
      PER_USER_HOME: false,
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
  ENV.TERMINAL.PER_USER_HOME = false
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

  beforeEach(() => {
    resetEnv()
    db = createTestDb()
    spawner = new FakePtySpawner()
    manager = new TerminalManager(db, spawner)
  })

  afterEach(() => {
    manager.shutdown()
    db.close()
  })

  it('creates a session with the configured shell and working directory', () => {
    const session = manager.create(actor, { cols: 80, rows: 24 })

    expect(spawner.spawnOptions).toEqual([
      { shell: '/bin/bash', cwd: '/workspace', cols: 80, rows: 24, isolateWorkspace: '/workspace' },
    ])
    expect(session.dimensions).toEqual({ cols: 80, rows: 24 })
    expect(manager.list(actor)).toHaveLength(1)
  })

  it('sandboxes non-admin terminals in the user workspace', () => {
    manager.create(actor, {})

    expect(spawner.spawnOptions[0]?.isolateWorkspace).toBe('/workspace')
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

  it('clamps requested dimensions to the configured defaults on bad input', () => {
    const session = manager.create(actor, { cols: Number.NaN, rows: undefined })

    expect(session.dimensions).toEqual({ cols: 100, rows: 30 })
  })

  it('spawns inside a private per-user directory when enabled', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'ocm-mgr-home-'))
    try {
      ENV.TERMINAL.CWD = base
      ENV.TERMINAL.PER_USER_HOME = true

      const session = manager.create(actor, {})

      const options = spawner.spawnOptions[0]
      expect(options?.cwd).toBe(session.cwd)
      expect(session.cwd.startsWith(path.join(base, 'users'))).toBe(true)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('rejects when the terminal is disabled or unavailable', () => {
    ENV.TERMINAL.ENABLED = false
    expect(captureError(() => manager.create(actor, {})).code).toBe('TERMINAL_DISABLED')
    ENV.TERMINAL.ENABLED = true

    const unavailable = new TerminalManager(db, { available: () => false, spawn: () => { throw new Error('nope') } })
    expect(unavailable.isAvailable()).toBe(false)
    expect(captureError(() => unavailable.create(actor, {})).code).toBe('TERMINAL_UNAVAILABLE')
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
    expect(started.cwd).toBe('/workspace')
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
      cwd: '/workspace',
      adminsOnly: true,
    })
  })
})
