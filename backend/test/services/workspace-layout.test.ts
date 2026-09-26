import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const state = vi.hoisted(() => ({ usersRoot: '', base: '' }))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getUsersWorkspacePath: () => state.usersRoot,
}))
vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { migrateUserWorkspaceLayout } from '../../src/services/workspace-layout'

function createUsersRoot() {
  state.base = mkdtempSync(path.join(tmpdir(), 'ocm-layout-'))
  state.usersRoot = path.join(state.base, 'users')
  mkdirSync(state.usersRoot, { recursive: true })
  return state.usersRoot
}

describe('migrateUserWorkspaceLayout', () => {
  afterEach(() => {
    if (state.base) {
      rmSync(state.base, { recursive: true, force: true })
    }
    state.base = ''
    state.usersRoot = ''
  })

  it('splits legacy content into workspace and setting', async () => {
    const usersRoot = createUsersRoot()
    const userRoot = path.join(usersRoot, 'alice')
    mkdirSync(path.join(userRoot, 'repos', 'demo'), { recursive: true })
    writeFileSync(path.join(userRoot, 'repos', 'demo', 'readme.md'), 'hi')
    mkdirSync(path.join(userRoot, 'assistant', 'sessions'), { recursive: true })
    writeFileSync(path.join(userRoot, 'opencode.json'), '{"model":"x"}')

    await migrateUserWorkspaceLayout()

    expect(readFileSync(path.join(userRoot, 'workspace', 'repos', 'demo', 'readme.md'), 'utf8')).toBe('hi')
    expect(existsSync(path.join(userRoot, 'setting', 'assistant', 'sessions'))).toBe(true)
    expect(readFileSync(path.join(userRoot, 'setting', 'opencode.json'), 'utf8')).toBe('{"model":"x"}')
    expect(existsSync(path.join(userRoot, 'repos'))).toBe(false)
    expect(existsSync(path.join(userRoot, 'assistant'))).toBe(false)
  })

  it('is idempotent for already-migrated users', async () => {
    const usersRoot = createUsersRoot()
    const userRoot = path.join(usersRoot, 'bob')
    mkdirSync(path.join(userRoot, 'workspace', 'repos'), { recursive: true })
    mkdirSync(path.join(userRoot, 'setting'), { recursive: true })
    writeFileSync(path.join(userRoot, 'workspace', 'notes.txt'), 'keep')

    await migrateUserWorkspaceLayout()
    await migrateUserWorkspaceLayout()

    expect(readFileSync(path.join(userRoot, 'workspace', 'notes.txt'), 'utf8')).toBe('keep')
    expect(existsSync(path.join(userRoot, 'setting'))).toBe(true)
  })

  it('leaves legacy entries in place when the target already exists', async () => {
    const usersRoot = createUsersRoot()
    const userRoot = path.join(usersRoot, 'carol')
    mkdirSync(path.join(userRoot, 'workspace', 'repos'), { recursive: true })
    writeFileSync(path.join(userRoot, 'workspace', 'repos', 'existing.txt'), 'keep')
    mkdirSync(path.join(userRoot, 'repos'))
    writeFileSync(path.join(userRoot, 'repos', 'legacy.txt'), 'legacy')

    await migrateUserWorkspaceLayout()

    expect(existsSync(path.join(userRoot, 'workspace', 'repos', 'existing.txt'))).toBe(true)
    expect(existsSync(path.join(userRoot, 'workspace', 'repos', 'legacy.txt'))).toBe(false)
    expect(existsSync(path.join(userRoot, 'repos', 'legacy.txt'))).toBe(true)
  })

  it('ignores a missing users root', async () => {
    state.base = mkdtempSync(path.join(tmpdir(), 'ocm-layout-'))
    state.usersRoot = path.join(state.base, 'missing')

    await expect(migrateUserWorkspaceLayout()).resolves.toBeUndefined()
  })
})
