import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { logger } from '../../src/utils/logger'
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

/** Narrowed here so a refusal fails as an assertion, not as a null in fs. */
function requireHome(userId: string): string {
  const home = resolveUserTerminalHome(userId)
  expect(home).not.toBeNull()
  return home as string
}

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
    const home = requireHome('user-1')

    expect(existsSync(home)).toBe(true)
    expect(isInsideDirectory(base, home)).toBe(true)
    expect(statSync(home).mode & 0o777).toBe(0o700)
    expect(home.startsWith(path.join(base, 'users'))).toBe(true)
  })

  it('is idempotent across repeated calls', () => {
    const first = requireHome('user-1')
    const second = requireHome('user-1')
    expect(second).toBe(first)
  })

  it('refuses to produce a home when per-user homes are disabled', () => {
    ENV.TERMINAL.PER_USER_HOME = false

    // Returning the workspace root here used to look like a safe default. It
    // is the one directory guaranteed to hold every user's data, so a non-admin
    // bound to it is holding everyone's repositories, not their own.
    expect(resolveUserTerminalHome('user-1')).toBeNull()
    expect(existsSync(path.join(base, 'users'))).toBe(false)
  })

  it('refuses when the home cannot be created, rather than widening the sandbox', () => {
    // A path whose parent is a file: mkdir fails with ENOTDIR, the way a full
    // disk or a permissions problem would.
    const blocked = path.join(base, 'blocked')
    writeFileSync(blocked, 'not a directory')
    ENV.TERMINAL.USERS_DIR = 'blocked/users'

    expect(resolveUserTerminalHome('user-1')).toBeNull()
  })

  it('refuses when the computed home escapes the workspace root', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})

    // `..` cannot be expressed through a valid username, so the escape is
    // reached the other way: a users directory that climbs out.
    ENV.TERMINAL.USERS_DIR = '../escaped'

    expect(resolveUserTerminalHome('user-1')).toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('escapes the workspace root'))
  })

  it('says which refusal happened - a silent null is how this hid before', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})
    ENV.TERMINAL.PER_USER_HOME = false

    resolveUserTerminalHome('user-1')

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('OCM_TERMINAL_PER_USER_HOME'))
  })
})
