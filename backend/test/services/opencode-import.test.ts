import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: vi.fn(),
}))

vi.mock('fs/promises', () => ({
  cp: vi.fn(),
  mkdtemp: vi.fn(),
  readdir: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
}))

vi.mock('bun:sqlite', () => ({
  Database: vi.fn().mockImplementation(() => ({
    exec: vi.fn(),
    close: vi.fn(),
  })),
}))

vi.mock('../../src/services/file-operations', () => ({
  ensureDirectoryExists: vi.fn(),
  fileExists: vi.fn(),
  readFileContent: vi.fn(),
}))

vi.mock('../../src/services/opencode-config-file', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/opencode-config-file')>()),
  readOpenCodeConfigFile: vi.fn(),
  restoreOpenCodeConfigSnapshot: vi.fn(),
}))

vi.mock('../../src/services/opencode-single-server', () => ({
  opencodeServerManager: {
    clearStartupError: vi.fn(),
  },
}))

vi.mock('@opencode-manager/shared/config/env', async (importOriginal) => {
  const path = await import('node:path')
  // Native paths, not POSIX literals. The service joins onto these
  // (`path.join(configDir, name)`, `path.join(getWorkspacePath(), ...)`), and
  // a join keeps the separator it was handed: on Windows a literal
  // `/tmp/workspace` becomes `\tmp\workspace`, which is not the string the
  // expectations below are written against.
  const workspace = path.resolve('/tmp/workspace')
  const configDir = path.join(workspace, '.config', 'opencode')
  return {
    ...(await importOriginal<typeof import('@opencode-manager/shared/config/env')>()),
    getConfigPath: vi.fn(() => configDir),
    getOpenCodeConfigFilePath: vi.fn(() => path.join(configDir, 'opencode.json')),
    getWorkspacePath: vi.fn(() => workspace),
  }
})

import path from 'path'
import os from 'os'
import { existsSync } from 'node:fs'
import { readdir, rm, cp, mkdtemp, rename } from 'fs/promises'
import { Database as SQLiteDatabase } from 'bun:sqlite'
import { ensureDirectoryExists, fileExists, readFileContent } from '../../src/services/file-operations'
import { readOpenCodeConfigFile, restoreOpenCodeConfigSnapshot, serializeOpenCodeConfigSnapshot } from '../../src/services/opencode-config-file'
import type { SettingsService } from '../../src/services/settings'
import { getOpenCodeImportStatus, syncOpenCodeImport } from '../../src/services/opencode-import'

const mockReaddir = readdir as unknown as ReturnType<typeof vi.fn>
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>
const mockFileExists = fileExists as ReturnType<typeof vi.fn>
const mockReadFileContent = readFileContent as ReturnType<typeof vi.fn>
const mockEnsureDirectoryExists = ensureDirectoryExists as ReturnType<typeof vi.fn>
const mockReadOpenCodeConfigFile = readOpenCodeConfigFile as ReturnType<typeof vi.fn>
const mockWriteOpenCodeConfigFile = restoreOpenCodeConfigSnapshot as ReturnType<typeof vi.fn>
const MockSQLiteDatabase = SQLiteDatabase as unknown as ReturnType<typeof vi.fn>
const mockMkdtemp = mkdtemp as unknown as ReturnType<typeof vi.fn>
const mockRename = rename as unknown as ReturnType<typeof vi.fn>

/**
 * The paths the service is expected to work with.
 *
 * The mocked environment module above computes the same values from the same
 * expressions, so the two agree without either one having to be exported
 * across the mock boundary.
 */
const WORKSPACE = path.resolve('/tmp/workspace')
const CONFIG_DIR = path.join(WORKSPACE, '.config', 'opencode')
const STATE_DIR = path.join(WORKSPACE, '.opencode', 'state')
const OPENCODE_STATE_DIR = path.join(STATE_DIR, 'opencode')
/** The host paths the import reads from; the service resolves them too. */
const IMPORT_CONFIG = path.resolve('/import/opencode-config/opencode.json')
const IMPORT_STATE = path.resolve('/import/opencode-state')

describe('opencode-import service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('OPENCODE_IMPORT_CONFIG_PATH', undefined)
    vi.stubEnv('OPENCODE_IMPORT_STATE_PATH', undefined)
    mockReadOpenCodeConfigFile.mockResolvedValue(null)
    mockReadFileContent.mockResolvedValue('{"$schema":"https://opencode.ai/config.json"}')
    mockReaddir.mockResolvedValue([])
    mockMkdtemp.mockResolvedValue(path.join(STATE_DIR, 'opencode-import-123'))
    mockRename.mockResolvedValue(undefined)
    mockExistsSync.mockImplementation((candidate: string) => candidate === process.env.OPENCODE_IMPORT_CONFIG_PATH)
  })

  afterEach(() => vi.unstubAllEnvs())

  it('imports every discovered global source without flattening or renaming JSONC', async () => {
    const jsonPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json')
    const jsoncPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc')
    mockExistsSync.mockImplementation((candidate: string) => [jsonPath, jsoncPath].includes(candidate))
    mockFileExists.mockResolvedValue(false)
    const rawJson = '{"model":"lower"}'
    const rawJsonc = '{\n// keep\n"model":"higher"\n}'
    mockReadFileContent.mockImplementation(async (candidate: string) => candidate === jsoncPath ? rawJsonc : rawJson)

    const result = await syncOpenCodeImport({})

    expect(result.configSourcePaths).toEqual([jsonPath, jsoncPath])
    expect(result.configSourcePath).toBe(jsoncPath)
    expect(mockWriteOpenCodeConfigFile).toHaveBeenCalledTimes(1)
    const snapshot = mockWriteOpenCodeConfigFile.mock.calls[0]![0] as string
    expect(snapshot).toContain(JSON.stringify(rawJson))
    expect(snapshot).toContain(JSON.stringify(rawJsonc))
    expect(snapshot).toContain('opencode.jsonc')
  })

  it('preserves an explicitly imported JSONC filename', async () => {
    // Resolved, because the service resolves the candidate before comparing
    // it, and the mock below matches the candidate against this value.
    process.env.OPENCODE_IMPORT_CONFIG_PATH = path.resolve('/import/opencode.jsonc')
    mockFileExists.mockResolvedValue(false)

    await syncOpenCodeImport({})

    expect(mockWriteOpenCodeConfigFile).toHaveBeenCalledWith(expect.stringContaining('opencode.jsonc'))
  })

  it('detects importable host config and state paths with opencode.db', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = IMPORT_CONFIG
    process.env.OPENCODE_IMPORT_STATE_PATH = IMPORT_STATE

    mockFileExists.mockImplementation(async (candidate: string) => {
      if (candidate === IMPORT_CONFIG) {
        return true
      }
      if (candidate === IMPORT_STATE) {
        return true
      }
      if (candidate === path.join(IMPORT_STATE, 'opencode.db')) {
        return true
      }
      if (candidate === path.join(OPENCODE_STATE_DIR, 'opencode.db')) {
        return true
      }
      return false
    })

    const status = await getOpenCodeImportStatus()

    expect(status).toEqual({
      configSourcePath: IMPORT_CONFIG,
      configSourcePaths: [IMPORT_CONFIG],
      stateSourcePath: IMPORT_STATE,
      workspaceConfigPath: path.join(CONFIG_DIR, 'opencode.jsonc'),
      workspaceConfigPathsToRemove: [],
      workspaceStatePath: OPENCODE_STATE_DIR,
      workspaceStateExists: true,
    })
  })

  it('reports workspace config sources absent from the host as pending removals', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = IMPORT_CONFIG
    const workspaceJsoncPath = path.join(CONFIG_DIR, 'opencode.jsonc')
    mockExistsSync.mockImplementation((candidate: string) =>
      candidate === IMPORT_CONFIG || candidate === workspaceJsoncPath)

    const status = await getOpenCodeImportStatus()

    expect(status.workspaceConfigPathsToRemove).toEqual([workspaceJsoncPath])
  })

  it('reports no pending removals when workspace and host share a config basename', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = IMPORT_CONFIG
    const workspaceJsonPath = path.join(CONFIG_DIR, 'opencode.json')
    mockExistsSync.mockImplementation((candidate: string) =>
      candidate === IMPORT_CONFIG || candidate === workspaceJsonPath)

    const status = await getOpenCodeImportStatus()

    expect(status.workspaceConfigPathsToRemove).toEqual([])
  })

  it('reports no pending removals when no host config source is detected', async () => {
    const workspaceJsoncPath = path.join(CONFIG_DIR, 'opencode.jsonc')
    mockExistsSync.mockImplementation((candidate: string) => candidate === workspaceJsoncPath)

    const status = await getOpenCodeImportStatus()

    expect(status.configSourcePaths).toEqual([])
    expect(status.workspaceConfigPathsToRemove).toEqual([])
  })

  it('imports host config and state into the workspace', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = IMPORT_CONFIG
    process.env.OPENCODE_IMPORT_STATE_PATH = IMPORT_STATE

    mockFileExists.mockImplementation(async (candidate: string) => {
      return candidate === IMPORT_CONFIG
        || candidate === IMPORT_STATE
        || candidate === path.join(IMPORT_STATE, 'opencode.db')
        || candidate === path.join(OPENCODE_STATE_DIR, 'opencode.db')
    })

    const result = await syncOpenCodeImport({
      overwriteState: true,
    })

    expect(result.configImported).toBe(true)
    expect(result.stateImported).toBe(true)
    expect(result.workspaceStateExists).toBe(true)
    expect(mockWriteOpenCodeConfigFile).toHaveBeenCalledWith(
      expect.stringContaining(JSON.stringify('{"$schema":"https://opencode.ai/config.json"}'))
    )
    expect(mockEnsureDirectoryExists).toHaveBeenCalledWith(STATE_DIR)
    expect(MockSQLiteDatabase).toHaveBeenCalledWith(path.join(IMPORT_STATE, 'opencode.db'))
    expect(mockRename).toHaveBeenCalledWith(
      path.join(STATE_DIR, 'opencode-import-123'),
      OPENCODE_STATE_DIR
    )
  })

  it('captures the previous on-disk config as last known good before importing over it', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = IMPORT_CONFIG

    mockFileExists.mockImplementation(async (candidate: string) => candidate === IMPORT_CONFIG)
    const previous = {
      path: path.join(CONFIG_DIR, 'opencode.json'),
      content: { theme: 'previous' },
      isValid: true,
      rawContent: '{"theme":"previous"}',
      updatedAt: 0,
      revision: 'rev-previous',
      sources: [{
        name: 'opencode.json' as const,
        path: path.join(CONFIG_DIR, 'opencode.json'),
        rawContent: '{"theme":"previous"}',
        content: { theme: 'previous' },
        isValid: true,
        updatedAt: 0,
      }],
    }
    mockReadOpenCodeConfigFile.mockResolvedValue(previous)
    const settingsService = { saveLastKnownGoodConfig: vi.fn() } as unknown as SettingsService

    await syncOpenCodeImport({ overwriteState: true, settingsService })

    expect(settingsService.saveLastKnownGoodConfig).toHaveBeenCalledWith(serializeOpenCodeConfigSnapshot(previous))
    expect(mockWriteOpenCodeConfigFile).toHaveBeenCalledWith(expect.stringContaining(JSON.stringify('{"$schema":"https://opencode.ai/config.json"}')))
  })

  it('does not capture last known good when no previous config file exists', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = IMPORT_CONFIG

    mockFileExists.mockImplementation(async (candidate: string) => candidate === IMPORT_CONFIG)
    mockReadOpenCodeConfigFile.mockResolvedValue(null)
    const settingsService = { saveLastKnownGoodConfig: vi.fn() } as unknown as SettingsService

    await syncOpenCodeImport({ overwriteState: true, settingsService })

    expect(settingsService.saveLastKnownGoodConfig).not.toHaveBeenCalled()
    expect(mockWriteOpenCodeConfigFile).toHaveBeenCalled()
  })

  it('does not report state imported when source db is missing', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = IMPORT_CONFIG
    process.env.OPENCODE_IMPORT_STATE_PATH = IMPORT_STATE

    mockFileExists.mockImplementation(async (candidate: string) => {
      return candidate === IMPORT_CONFIG
        || candidate === IMPORT_STATE
    })

    const result = await syncOpenCodeImport({
      overwriteState: true,
    })

    expect(result.configImported).toBe(true)
    expect(result.stateImported).toBe(false)
    expect(mockEnsureDirectoryExists).not.toHaveBeenCalled()
  })

  it('reports the resolved import config candidate as the config source path', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = process.execPath

    const status = await getOpenCodeImportStatus()

    expect(status.configSourcePath).toBe(process.execPath)
  })

  it('rejects invalid importable config content with the existing error', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = IMPORT_CONFIG

    mockFileExists.mockImplementation(async (candidate: string) => candidate === IMPORT_CONFIG)
    mockReadFileContent.mockResolvedValue('{"model": 123}')

    await expect(syncOpenCodeImport({ overwriteState: true })).rejects.toThrow('Importable OpenCode config is invalid')
    expect(mockWriteOpenCodeConfigFile).not.toHaveBeenCalled()
  })

  it('imports state without rewriting the config when importConfig is false', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = IMPORT_CONFIG
    process.env.OPENCODE_IMPORT_STATE_PATH = IMPORT_STATE

    mockFileExists.mockImplementation(async (candidate: string) => {
      return candidate === IMPORT_CONFIG
        || candidate === IMPORT_STATE
        || candidate === path.join(IMPORT_STATE, 'opencode.db')
    })

    const result = await syncOpenCodeImport({ overwriteState: false, importConfig: false })

    expect(result.configImported).toBe(false)
    expect(result.stateImported).toBe(true)
    expect(mockWriteOpenCodeConfigFile).not.toHaveBeenCalled()
  })

  it('reads distinct session directories from imported workspace state', async () => {
    mockFileExists.mockImplementation(async (candidate: string) => candidate === path.join(OPENCODE_STATE_DIR, 'opencode.db'))

    const readonlyDatabase = {
      query: vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue([
          { directory: '/Users/test/project-a' },
          { directory: ' /Users/test/project-b/apps/web ' },
        ]),
      }),
      close: vi.fn(),
    }

    MockSQLiteDatabase.mockImplementationOnce(() => readonlyDatabase)

    const { getImportedSessionDirectories } = await import('../../src/services/opencode-import')
    const result = await getImportedSessionDirectories(OPENCODE_STATE_DIR)

    expect(result.directories).toEqual([
      '/Users/test/project-a',
      '/Users/test/project-b/apps/web',
    ])
    expect(readonlyDatabase.close).toHaveBeenCalled()
  })

  it('reports stateSourcePath as null when candidate directory exists but lacks opencode.db', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = IMPORT_CONFIG
    process.env.OPENCODE_IMPORT_STATE_PATH = IMPORT_STATE

    mockFileExists.mockImplementation(async (candidate: string) => {
      if (candidate === IMPORT_CONFIG) {
        return true
      }
      if (candidate === IMPORT_STATE) {
        return true
      }
      if (candidate === path.join(IMPORT_STATE, 'opencode.db')) {
        return false
      }
      if (candidate === path.join(OPENCODE_STATE_DIR, 'opencode.db')) {
        return false
      }
      return false
    })

    const status = await getOpenCodeImportStatus()

    expect(status.configSourcePath).toBe(IMPORT_CONFIG)
    expect(status.stateSourcePath).toBeNull()
    expect(status.workspaceStateExists).toBe(false)
  })

  it('prevents destructive self-import when source and target resolve to same directory', async () => {
    const { importOpenCodeStateDirectory } = await import('../../src/services/opencode-import')

    const samePath = '/shared/opencode-state'
    mockFileExists.mockResolvedValue(true)
    mockEnsureDirectoryExists.mockResolvedValue(undefined)
    mockReaddir.mockResolvedValue([])

    const mockRm = vi.mocked(rm)
    mockRm.mockResolvedValue(undefined)

    const result = await importOpenCodeStateDirectory(samePath, samePath)

    expect(result).toBe(false)
    expect(mockRm).not.toHaveBeenCalled()
    expect(MockSQLiteDatabase).not.toHaveBeenCalled()
  })

  it('blocks import when workspace state exists and overwriteState is not enabled', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = IMPORT_CONFIG
    process.env.OPENCODE_IMPORT_STATE_PATH = IMPORT_STATE

    mockFileExists.mockImplementation(async (candidate: string) => {
      return candidate === IMPORT_CONFIG
        || candidate === IMPORT_STATE
        || candidate === path.join(IMPORT_STATE, 'opencode.db')
        || candidate === path.join(OPENCODE_STATE_DIR, 'opencode.db')
    })

    await expect(syncOpenCodeImport({
      overwriteState: false,
      protectExistingState: true,
    })).rejects.toThrow('OpenCode host import was blocked to protect existing workspace state')

    expect(mockWriteOpenCodeConfigFile).not.toHaveBeenCalled()
    expect(mockEnsureDirectoryExists).not.toHaveBeenCalled()
  })

  it('stages imported state before replacing the target directory', async () => {
    const { importOpenCodeStateDirectory } = await import('../../src/services/opencode-import')

    const sourcePath = IMPORT_STATE
    const targetPath = path.resolve('/workspace/.opencode/state/opencode')
    const stagedPath = path.resolve('/workspace/.opencode/state/opencode-import-123')

    mockFileExists.mockImplementation(async (candidate: string) => {
      if (candidate === path.join(sourcePath, 'opencode.db')) {
        return true
      }
      return false
    })

    mockEnsureDirectoryExists.mockResolvedValue(undefined)
    mockReaddir.mockResolvedValue([
      { name: 'stale-file.txt', isDirectory: () => false },
      { name: 'opencode.db', isDirectory: () => false },
    ] as any)
    const mockRm = vi.mocked(rm)
    mockRm.mockResolvedValue(undefined)
    mockMkdtemp.mockResolvedValue(stagedPath)

    const mockCp = vi.mocked(cp)
    mockCp.mockResolvedValue(undefined)

    const mockExec = vi.fn()
    const mockClose = vi.fn()
    MockSQLiteDatabase.mockImplementationOnce(() => ({
      exec: mockExec,
      close: mockClose,
    }))

    const result = await importOpenCodeStateDirectory(sourcePath, targetPath)

    expect(result).toBe(true)
    expect(mockCp).toHaveBeenCalledWith(
      path.join(sourcePath, 'stale-file.txt'),
      path.join(stagedPath, 'stale-file.txt'),
      expect.any(Object)
    )
    expect(mockExec).toHaveBeenCalled()
    expect(mockRm).toHaveBeenCalledWith(targetPath, { recursive: true, force: true })
    expect(mockRename).toHaveBeenCalledWith(stagedPath, targetPath)
  })

  it('cleans up the staged import directory when snapshotting fails', async () => {
    const { importOpenCodeStateDirectory } = await import('../../src/services/opencode-import')

    const sourcePath = IMPORT_STATE
    const targetPath = path.resolve('/workspace/.opencode/state/opencode')
    const stagedPath = path.resolve('/workspace/.opencode/state/opencode-import-456')

    mockFileExists.mockImplementation(async (candidate: string) => candidate === path.join(sourcePath, 'opencode.db'))
    mockEnsureDirectoryExists.mockResolvedValue(undefined)
    mockMkdtemp.mockResolvedValue(stagedPath)

    const mockExec = vi.fn(() => {
      throw new Error('snapshot failed')
    })
    const mockClose = vi.fn()
    MockSQLiteDatabase.mockImplementationOnce(() => ({
      exec: mockExec,
      close: mockClose,
    }))

    const mockRm = vi.mocked(rm)
    mockRm.mockResolvedValue(undefined)

    await expect(importOpenCodeStateDirectory(sourcePath, targetPath)).rejects.toThrow('snapshot failed')

    expect(mockRm).toHaveBeenCalledWith(stagedPath, { recursive: true, force: true })
    expect(mockRm).not.toHaveBeenCalledWith(targetPath, { recursive: true, force: true })
    expect(mockRename).not.toHaveBeenCalled()
  })
})
