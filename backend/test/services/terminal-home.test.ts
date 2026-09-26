import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isInsideDirectory, resolveUserTerminalHome, safeUserDirectoryName } from '../../src/services/terminal/home'

const { ENV } = vi.hoisted(() => ({
  ENV: {
    TERMINAL: {
      CWD: '/workspace',
      PER_USER_HOME: true,
      USERS_DIR: 'users',
    },
  },
}))

vi.mock('@opencode-manager/shared/config/env', () => ({ ENV }))
vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

let base: string

describe('terminal home resolution', () => {
  beforeEach(() => {
    base = mkdtempSync(path.join(tmpdir(), 'ocm-term-home-'))
    ENV.TERMINAL.CWD = base
    ENV.TERMINAL.PER_USER_HOME = true
    ENV.TERMINAL.USERS_DIR = 'users'
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('builds filesystem-safe, collision-resistant directory names', () => {
    const first = safeUserDirectoryName('a@b.com')
    const second = safeUserDirectoryName('ab.com')

    expect(first).toMatch(/^[a-zA-Z0-9_-]+-[0-9a-f]{8}$/)
    expect(first).not.toBe(second)
    expect(safeUserDirectoryName('../../etc')).not.toContain('/')
    expect(safeUserDirectoryName('../../etc')).not.toContain('..')
  })

  it('detects directory containment', () => {
    expect(isInsideDirectory('/workspace', '/workspace/users/a')).toBe(true)
    expect(isInsideDirectory('/workspace', '/workspace')).toBe(true)
    expect(isInsideDirectory('/workspace', '/workspace-evil/x')).toBe(false)
    expect(isInsideDirectory('/workspace', '/etc/passwd')).toBe(false)
  })

  it('creates a private per-user directory inside the workspace', () => {
    const home = resolveUserTerminalHome('user-1')

    expect(existsSync(home)).toBe(true)
    expect(isInsideDirectory(base, home)).toBe(true)
    expect(statSync(home).mode & 0o777).toBe(0o700)
    expect(home.startsWith(path.join(base, 'users'))).toBe(true)
  })

  it('is idempotent across repeated calls', () => {
    const first = resolveUserTerminalHome('user-1')
    const second = resolveUserTerminalHome('user-1')
    expect(second).toBe(first)
  })

  it('returns the base workspace when per-user homes are disabled', () => {
    ENV.TERMINAL.PER_USER_HOME = false
    expect(resolveUserTerminalHome('user-1')).toBe(base)
    expect(existsSync(path.join(base, 'users'))).toBe(false)
  })
})
