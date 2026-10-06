import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import { Database } from 'bun:sqlite'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { findUserIdByToken, getOrCreateInternalToken, getOrCreateUserToken } from '../../src/services/internal-token'

const mockGetSettings = vi.fn()
const mockUpdateSettings = vi.fn()
const mockResetSettings = vi.fn()
const mockGetLastKnownGoodConfig = vi.fn()
const {
  mockReadOpenCodeConfigFile,
  mockDeleteOpenCodeConfigFile,
  mockArchiveBrokenOpenCodeConfigFile,
  mockRestoreOpenCodeConfigSnapshot,
  mockApplyOpenCodeConfigUpdate,
} = vi.hoisted(() => ({
  mockReadOpenCodeConfigFile: vi.fn(),
  mockDeleteOpenCodeConfigFile: vi.fn(),
  mockArchiveBrokenOpenCodeConfigFile: vi.fn(),
  mockRestoreOpenCodeConfigSnapshot: vi.fn(),
  mockApplyOpenCodeConfigUpdate: vi.fn(),
}))

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  promises: {
    mkdir: vi.fn(),
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    stat: vi.fn(),
    chmod: vi.fn(),
    unlink: vi.fn(),
    rm: vi.fn(),
    readdir: vi.fn(),
  },
}))

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('../../src/constants', () => ({
  DEFAULT_AGENTS_MD: '# Test Agents MD',
}))

const {
  mockHasStoredOpenCodeServerPassword,
  mockGetStoredOpenCodeServerPasswordState,
  mockClearOpenCodeServerPassword,
  mockSetOpenCodeServerPassword,
  mockRestoreOpenCodeServerPasswordState,
} = vi.hoisted(() => ({
  mockHasStoredOpenCodeServerPassword: vi.fn(),
  mockGetStoredOpenCodeServerPasswordState: vi.fn(),
  mockClearOpenCodeServerPassword: vi.fn(),
  mockSetOpenCodeServerPassword: vi.fn(),
  mockRestoreOpenCodeServerPasswordState: vi.fn(),
}))

vi.mock('../../src/services/settings', () => ({
  SettingsService: vi.fn().mockImplementation(() => ({
    getSettings: mockGetSettings,
    updateSettings: mockUpdateSettings,
    resetSettings: mockResetSettings,
    getLastKnownGoodConfig: mockGetLastKnownGoodConfig,
    hasStoredOpenCodeServerPassword: mockHasStoredOpenCodeServerPassword,
    getStoredOpenCodeServerPasswordState: mockGetStoredOpenCodeServerPasswordState,
    clearOpenCodeServerPassword: mockClearOpenCodeServerPassword,
    setOpenCodeServerPassword: mockSetOpenCodeServerPassword,
    restoreOpenCodeServerPasswordState: mockRestoreOpenCodeServerPasswordState,
  })),
}))

const {
  mockListManagedSkills,
  mockGetSkill,
  mockCreateSkill,
  mockUpdateSkill,
  mockDeleteSkill,
  mockInstallSkillFromGithubTree,
  mockInstallSkillFromUploadedFiles,
} = vi.hoisted(() => ({
  mockListManagedSkills: vi.fn(),
  mockGetSkill: vi.fn(),
  mockCreateSkill: vi.fn(),
  mockUpdateSkill: vi.fn(),
  mockDeleteSkill: vi.fn(),
  mockInstallSkillFromGithubTree: vi.fn(),
  mockInstallSkillFromUploadedFiles: vi.fn(),
}))

vi.mock('../../src/services/skills', () => ({
  listManagedSkills: mockListManagedSkills,
  getSkill: mockGetSkill,
  createSkill: mockCreateSkill,
  updateSkill: mockUpdateSkill,
  deleteSkill: mockDeleteSkill,
  installSkillFromGithubTree: mockInstallSkillFromGithubTree,
  installSkillFromUploadedFiles: mockInstallSkillFromUploadedFiles,
}))

const {
  mockInstallOpenCodeDirectoryFiles,
  mockListOpenCodeDirectoryFiles,
  mockGetOpenCodeDirectoryFile,
  mockUpdateOpenCodeDirectoryFile,
  mockDeleteOpenCodeDirectoryFile,
} = vi.hoisted(() => ({
  mockInstallOpenCodeDirectoryFiles: vi.fn(),
  mockListOpenCodeDirectoryFiles: vi.fn(),
  mockGetOpenCodeDirectoryFile: vi.fn(),
  mockUpdateOpenCodeDirectoryFile: vi.fn(),
  mockDeleteOpenCodeDirectoryFile: vi.fn(),
}))

vi.mock('../../src/services/opencode-directory-files', () => ({
  installOpenCodeDirectoryFiles: mockInstallOpenCodeDirectoryFiles,
  listOpenCodeDirectoryFiles: mockListOpenCodeDirectoryFiles,
  getOpenCodeDirectoryFile: mockGetOpenCodeDirectoryFile,
  updateOpenCodeDirectoryFile: mockUpdateOpenCodeDirectoryFile,
  deleteOpenCodeDirectoryFile: mockDeleteOpenCodeDirectoryFile,
}))

const { mockDiscoverModelsCached } = vi.hoisted(() => ({
  mockDiscoverModelsCached: vi.fn(),
}))

vi.mock('../../src/utils/discovery-cache', () => ({
  discoverModelsCached: mockDiscoverModelsCached,
}))

const { mockValidateSSHPrivateKey } = vi.hoisted(() => ({
  mockValidateSSHPrivateKey: vi.fn(),
}))

vi.mock('../../src/utils/ssh-key-manager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/ssh-key-manager')>()
  return {
    ...actual,
    writeTemporarySSHKey: vi.fn(async (_content: string, identifier: string) => `/tmp/mock-ssh-key-${identifier}`),
    cleanupSSHKey: vi.fn(async () => undefined),
  }
})

vi.mock('../../src/utils/ssh-validation', () => ({
  validateSSHPrivateKey: mockValidateSSHPrivateKey,
}))

vi.mock('../../src/services/file-operations', () => ({
  writeFileContent: vi.fn(),
  readFileContent: vi.fn(),
  fileExists: vi.fn(),
}))

vi.mock('../../src/services/opencode-config-file', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/opencode-config-file')>()
  return {
    ...actual,
    readOpenCodeConfigFile: mockReadOpenCodeConfigFile,
    deleteOpenCodeConfigFile: mockDeleteOpenCodeConfigFile,
    archiveBrokenOpenCodeConfigFile: mockArchiveBrokenOpenCodeConfigFile,
    restoreOpenCodeConfigSnapshot: mockRestoreOpenCodeConfigSnapshot,
    withOpenCodeConfigLock: (fn: () => Promise<unknown>) => fn(),
  }
})

vi.mock('../../src/services/opencode-config-apply', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/opencode-config-apply')>()
  return {
    ...actual,
    applyOpenCodeConfigUpdate: mockApplyOpenCodeConfigUpdate,
  }
})

vi.mock('../../src/services/opencode/client', () => ({
  createOpenCodeClient: () => ({
    forward: vi.fn(),
    forwardRaw: vi.fn(),
    getJson: vi.fn(),
    postJson: vi.fn(),
    setProviderAuth: vi.fn(),
    deleteProviderAuth: vi.fn(),
  }),
}))

vi.mock('../../src/services/opencode-single-server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/opencode-single-server')>()
  
  class MockConfigReloadError extends Error {
    validationIssues: Array<{ path: string; message: string }>

    constructor(message: string, validationIssues: Array<{ path: string; message: string }> = []) {
      super(message)
      this.name = 'ConfigReloadError'
      this.validationIssues = validationIssues
    }
  }

  return {
    ...actual,
    opencodeServerManager: {
      getVersion: vi.fn(),
      fetchVersion: vi.fn(),
      restart: vi.fn(),
      clearStartupError: vi.fn(),
      getLastStartupError: vi.fn(),
      checkHealth: vi.fn().mockResolvedValue(true),
      markRestartPending: vi.fn(),
      isRestartPending: vi.fn(),
      setDatabase: vi.fn(),
      reinitializeBinDirectory: vi.fn(),
    },
    ConfigReloadError: MockConfigReloadError,
  }
})

vi.mock('../../src/services/opencode-import', () => ({
  OpenCodeImportProtectionError: class OpenCodeImportProtectionError extends Error {
    code = 'OPENCODE_IMPORT_PROTECTED'
    detail: string

    constructor(detail: string) {
      super('OpenCode host import was blocked to protect existing workspace state')
      this.detail = detail
    }
  },
  getOpenCodeImportStatus: vi.fn(),
  syncOpenCodeImport: vi.fn(),
  getImportedSessionDirectories: vi.fn(),
}))

vi.mock('../../src/services/repo', () => ({
  relinkReposFromSessionDirectories: vi.fn(),
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getWorkspacePath: vi.fn(() => '/tmp/test-workspace'),
  getReposPath: vi.fn(() => '/tmp/test-repos'),
  getOpenCodeConfigFilePath: vi.fn(() => '/tmp/test-workspace/.config/opencode.json'),
  getOpenCodeHealthWatchPath: vi.fn(() => '/tmp/test-workspace/health-watch'),
  getAgentsMdPath: vi.fn(() => '/tmp/test-workspace/AGENTS.md'),
  getDatabasePath: vi.fn(() => ':memory:'),
  getConfigPath: vi.fn(() => '/tmp/test-workspace/config'),
  OPENCODE_CONFIG_SOURCE_NAMES: ['config.json', 'opencode.json', 'opencode.jsonc'],
  ENV: {
    SERVER: { PORT: 5003, HOST: '0.0.0.0', NODE_ENV: 'test' },
    AUTH: { TRUSTED_ORIGINS: 'http://localhost:5173', SECRET: 'test-secret-for-encryption-key-32c' },
    WORKSPACE: { BASE_PATH: '/tmp/test-workspace', REPOS_DIR: 'repos', CONFIG_DIR: 'config', AUTH_FILE: 'auth.json' },
    OPENCODE: { PORT: 5551, HOST: '127.0.0.1' },
    DATABASE: { PATH: ':memory:' },
    FILE_LIMITS: {
      MAX_SIZE_BYTES: 1024 * 1024,
      MAX_UPLOAD_SIZE_BYTES: 10 * 1024 * 1024,
    },
  },
  FILE_LIMITS: {
    MAX_SIZE_BYTES: 1024 * 1024,
    MAX_UPLOAD_SIZE_BYTES: 10 * 1024 * 1024,
  },
}))

import { Hono } from 'hono'
import type { Context } from 'hono'
import { createSettingsRoutes } from '../../src/routes/settings'
import { createSessionUser } from '../helpers/session-user'
import type { Session } from '../../src/auth'
import { getImportedSessionDirectories, getOpenCodeImportStatus, OpenCodeImportProtectionError, syncOpenCodeImport } from '../../src/services/opencode-import'
import { relinkReposFromSessionDirectories } from '../../src/services/repo'
import { opencodeServerManager } from '../../src/services/opencode-single-server'
import { setOpenCodeRestartCoordinator } from '../../src/services/opencode-restart'
import { createRepo } from '../../src/db/queries'

const mockSpawnSync = spawnSync as ReturnType<typeof vi.fn>
const mockGetVersion = opencodeServerManager.getVersion as ReturnType<typeof vi.fn>
const mockFetchVersion = opencodeServerManager.fetchVersion as ReturnType<typeof vi.fn>
const mockRestart = opencodeServerManager.restart as ReturnType<typeof vi.fn>
const mockClearStartupError = opencodeServerManager.clearStartupError as ReturnType<typeof vi.fn>
const mockGetLastStartupError = opencodeServerManager.getLastStartupError as ReturnType<typeof vi.fn>
const mockGetOpenCodeImportStatus = getOpenCodeImportStatus as ReturnType<typeof vi.fn>
const mockSyncOpenCodeImport = syncOpenCodeImport as ReturnType<typeof vi.fn>
const mockGetImportedSessionDirectories = getImportedSessionDirectories as ReturnType<typeof vi.fn>
const mockRelinkReposFromSessionDirectories = relinkReposFromSessionDirectories as ReturnType<typeof vi.fn>

/**
 * The settings routes behind a signed-in user.
 *
 * Wrapped rather than fetched directly because the OpenCode config routes are
 * admin-only, so a test that calls them has to say who it is. Going through the
 * real middleware is also what proves the gate is the middleware's and not
 * something each test remembers to assert.
 */
function withSessionUser(db: unknown, role: 'admin' | 'user') {
  const app = new Hono<{ Variables: { user: Session['user']; session: Session['session'] } }>()
  app.use('*', async (c, next) => {
    c.set('user', createSessionUser(role))
    c.set('session', { id: 'session-1' } as Session['session'])
    await next()
  })
  app.route('/', createSettingsRoutes(
    db as never,
    { getGitEnvironment: vi.fn().mockReturnValue({}) } as never,
    createStubOpenCodeClient(),
  ) as unknown as Hono)
  return app
}

describe('Settings Routes - OpenCode Upgrade', () => {
  let settingsApp: ReturnType<typeof withSessionUser>
  let testDb: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetVersion.mockReset()
    mockFetchVersion.mockReset()
    mockRestart.mockReset()
    mockClearStartupError.mockReset()
    mockGetSettings.mockReset()
    mockUpdateSettings.mockReset()
    mockResetSettings.mockReset()
    mockGetLastKnownGoodConfig.mockReset()
    mockGetOpenCodeImportStatus.mockReset()
    mockSyncOpenCodeImport.mockReset()
    mockGetImportedSessionDirectories.mockReset()
    mockRelinkReposFromSessionDirectories.mockReset()
    mockReadOpenCodeConfigFile.mockReset()
    mockDeleteOpenCodeConfigFile.mockReset()
    mockArchiveBrokenOpenCodeConfigFile.mockReset()
    mockRestoreOpenCodeConfigSnapshot.mockReset()
    mockApplyOpenCodeConfigUpdate.mockReset()
    
    testDb = {} as any
    settingsApp = withSessionUser(testDb, 'admin')

    mockRestart.mockResolvedValue(undefined)
    mockClearStartupError.mockReturnValue(undefined)
    mockGetOpenCodeImportStatus.mockResolvedValue({
      configSourcePath: null,
      stateSourcePath: null,
      workspaceConfigPath: '/tmp/test-workspace/.config/opencode/opencode.json',
      workspaceStatePath: '/tmp/test-workspace/.opencode/state/opencode',
      workspaceStateExists: false,
    })
    mockGetImportedSessionDirectories.mockResolvedValue({
      directories: ['/Users/test/project-a', '/Users/test/project-b/apps/web'],
    })
    mockRelinkReposFromSessionDirectories.mockResolvedValue({
      repos: [],
      relinkedCount: 0,
      existingCount: 0,
      nonRepoPathCount: 0,
      duplicatePathCount: 0,
      errors: [],
    })
  })

  describe('OpenCode config routes', () => {
    it('refuses every route to a signed-in non-admin', async () => {
      const app = withSessionUser(testDb, 'user')

      const get = await app.fetch(new Request('http://localhost/opencode-config'))
      const effective = await app.fetch(new Request('http://localhost/opencode-config/effective'))
      const put = await app.fetch(new Request('http://localhost/opencode-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { provider: { mine: { options: { baseURL: 'https://x' } } } } }),
      }))

      expect([get.status, effective.status, put.status]).toEqual([403, 403, 403])
      // The refusal has to happen before the body is even looked at: a route
      // that validated first would still tell a stranger whether their payload
      // was well formed.
      expect((await put.json() as { error: string }).error).toBe('Forbidden')
      expect(mockReadOpenCodeConfigFile).not.toHaveBeenCalled()
      expect(mockApplyOpenCodeConfigUpdate).not.toHaveBeenCalled()
    })

    it('carries the caller and their address into the apply so the write can be attributed', async () => {
      const config = {
        path: '/tmp/test-workspace/.config/opencode.json',
        content: { theme: 'light' },
        rawContent: '{"theme":"light"}',
        isValid: true,
        updatedAt: 4,
        sources: [],
        revision: 'rev-1',
      }
      mockApplyOpenCodeConfigUpdate.mockResolvedValueOnce({ status: 'applied', config })
      const app = withSessionUser(testDb, 'admin')

      await app.fetch(new Request('http://localhost/opencode-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'user-agent': 'vitest', 'x-real-ip': '203.0.113.9' },
        body: JSON.stringify({ content: { theme: 'light' } }),
      }))

      expect(mockApplyOpenCodeConfigUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: {
            userId: 'me',
            userEmail: 'me@example.com',
            // The suite runs without TRUST_PROXY, so a forwarded address is
            // not believed. Recording it anyway would let anyone who can reach
            // the app forge the address on a row that is meant to say where the
            // write came from.
            ipAddress: null,
            userAgent: 'vitest',
          },
        }),
      )
    })

    it('returns the on-disk config state from GET /opencode-config', async () => {
      const fileState = {
        path: '/tmp/test-workspace/.config/opencode.json',
        content: { theme: 'dark' },
        rawContent: '{"theme":"dark"}',
        isValid: true,
        updatedAt: 1,
      }
      mockReadOpenCodeConfigFile.mockResolvedValueOnce(fileState)

      const res = await settingsApp.fetch(new Request('http://localhost/opencode-config'))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json).toEqual(fileState)
    })

    it('returns 404 from GET /opencode-config when no config file exists', async () => {
      mockReadOpenCodeConfigFile.mockResolvedValueOnce(null)

      const res = await settingsApp.fetch(new Request('http://localhost/opencode-config'))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(404)
      expect(json.error).toBe('No OpenCode config file found')
    })

    it('maps a restart-pending apply result to 200 with restartRequired', async () => {
      const config = {
        path: '/tmp/test-workspace/.config/opencode.json',
        content: { plugin: ['evil-plugin'] },
        rawContent: '{"plugin":["evil-plugin"]}',
        isValid: true,
        updatedAt: 2,
      }
      mockApplyOpenCodeConfigUpdate.mockResolvedValueOnce({ status: 'restart_pending', config })

      const res = await settingsApp.fetch(new Request('http://localhost/opencode-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '{"plugin":["evil-plugin"]}' }),
      }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json).toEqual({ ...config, restartRequired: true })
      expect(mockApplyOpenCodeConfigUpdate).toHaveBeenCalledWith({
        content: '{"plugin":["evil-plugin"]}',
        source: undefined,
        expectedRevision: undefined,
        settingsService: expect.anything(),
        db: testDb,
        actor: {
          userId: 'me',
          userEmail: 'me@example.com',
          ipAddress: null,
          userAgent: null,
        },
      })
    })

    it('maps an unchanged applied result to 200 without requesting a restart', async () => {
      const config = {
        path: '/tmp/test-workspace/.config/opencode.json',
        content: { theme: 'light' },
        rawContent: '{"theme":"light"}',
        isValid: true,
        updatedAt: 3,
      }
      mockApplyOpenCodeConfigUpdate.mockResolvedValueOnce({ status: 'applied', config })

      const res = await settingsApp.fetch(new Request('http://localhost/opencode-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { theme: 'light' } }),
      }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json).toEqual(config)
      expect(mockApplyOpenCodeConfigUpdate).toHaveBeenCalledWith({
        content: { theme: 'light' },
        source: undefined,
        expectedRevision: undefined,
        settingsService: expect.anything(),
        db: testDb,
        actor: expect.objectContaining({ userId: 'me' }),
      })
    })

    it('returns 400 when the PUT body fails schema validation', async () => {
      const res = await settingsApp.fetch(new Request('http://localhost/opencode-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 123 }),
      }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(400)
      expect(json.error).toBe('Invalid config data')
      expect(mockApplyOpenCodeConfigUpdate).not.toHaveBeenCalled()
    })

    it('returns 400 when the PUT body is malformed JSON', async () => {
      const res = await settingsApp.fetch(new Request('http://localhost/opencode-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(400)
      expect(json.error).toBe('Invalid JSON')
      expect(mockApplyOpenCodeConfigUpdate).not.toHaveBeenCalled()
    })

    it('returns 400 when the PUT body is empty', async () => {
      const res = await settingsApp.fetch(new Request('http://localhost/opencode-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
      }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(400)
      expect(json.error).toBe('Invalid JSON')
      expect(mockApplyOpenCodeConfigUpdate).not.toHaveBeenCalled()
    })

    it('returns 500 when applying the config fails', async () => {
      mockApplyOpenCodeConfigUpdate.mockRejectedValueOnce(new Error('write failed'))

      const res = await settingsApp.fetch(new Request('http://localhost/opencode-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '{"theme":"light"}' }),
      }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(500)
      expect(json.error).toBe('Failed to update OpenCode config')
    })

    it('writes the last known good config and restarts on rollback', async () => {
      mockGetLastKnownGoodConfig.mockReturnValueOnce('{"theme":"dark"}')
      mockRestoreOpenCodeConfigSnapshot.mockResolvedValueOnce({
        path: '/tmp/test-workspace/.config/opencode.json',
        rawContent: '{"theme":"dark"}',
        content: { theme: 'dark' },
        isValid: true,
        updatedAt: 1,
      })
      mockReadOpenCodeConfigFile.mockResolvedValueOnce({
        path: '/tmp/test-workspace/.config/opencode.json',
        rawContent: '{"theme":"dark"}',
        content: { theme: 'dark' },
        isValid: true,
        updatedAt: 1,
      })

      const res = await settingsApp.fetch(new Request('http://localhost/opencode-rollback', { method: 'POST' }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json).toEqual({ success: true, message: 'Server reloaded with the previous working config' })
      expect(mockRestoreOpenCodeConfigSnapshot).toHaveBeenCalledWith('{"theme":"dark"}')
      expect(mockClearStartupError).toHaveBeenCalled()
      expect(mockRestart).toHaveBeenCalled()
    })

    it('returns 404 from rollback when no last known good config exists', async () => {
      mockGetLastKnownGoodConfig.mockReturnValueOnce(null)

      const res = await settingsApp.fetch(new Request('http://localhost/opencode-rollback', { method: 'POST' }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(404)
      expect(json.error).toBe('No previous working config available for rollback')
      expect(mockRestoreOpenCodeConfigSnapshot).not.toHaveBeenCalled()
    })

    it('deletes the config file and restarts when the rollback reload fails', async () => {
      mockGetLastKnownGoodConfig.mockReturnValueOnce('{"theme":"dark"}')
      mockRestoreOpenCodeConfigSnapshot.mockResolvedValueOnce({
        path: '/tmp/test-workspace/.config/opencode.json',
        rawContent: '{"theme":"dark"}',
        content: { theme: 'dark' },
        isValid: true,
        updatedAt: 1,
      })
      mockReadOpenCodeConfigFile.mockResolvedValueOnce(null)
      mockDeleteOpenCodeConfigFile.mockResolvedValueOnce(true)

      const res = await settingsApp.fetch(new Request('http://localhost/opencode-rollback', { method: 'POST' }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json).toEqual({
        success: true,
        message: 'Server restarted after deleting the broken config file. The previous working config remains available for rollback.',
        fallback: true,
      })
      expect(mockRestoreOpenCodeConfigSnapshot).toHaveBeenCalledWith('{"theme":"dark"}')
      expect(mockArchiveBrokenOpenCodeConfigFile).toHaveBeenCalled()
      expect(mockDeleteOpenCodeConfigFile).toHaveBeenCalled()
      expect(mockRestart).toHaveBeenCalled()
    })
  })

  describe('OpenCode import routes', () => {
    it('should return import status', async () => {
      mockGetOpenCodeImportStatus.mockResolvedValueOnce({
        configSourcePath: '/import/opencode-config/opencode.json',
        stateSourcePath: '/import/opencode-state',
        workspaceConfigPath: '/tmp/test-workspace/.config/opencode/opencode.json',
        workspaceStatePath: '/tmp/test-workspace/.opencode/state/opencode',
        workspaceStateExists: true,
      })

      const req = new Request('http://localhost/opencode-import/status')
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.configSourcePath).toBe('/import/opencode-config/opencode.json')
      expect(json.stateSourcePath).toBe('/import/opencode-state')
      expect(mockGetOpenCodeImportStatus).toHaveBeenCalled()
    })

    it('should import host OpenCode data and restart the server', async () => {
      mockSyncOpenCodeImport.mockResolvedValueOnce({
        configSourcePath: '/import/opencode-config/opencode.json',
        stateSourcePath: '/import/opencode-state',
        workspaceConfigPath: '/tmp/test-workspace/.config/opencode/opencode.json',
        workspaceStatePath: '/tmp/test-workspace/.opencode/state/opencode',
        workspaceStateExists: true,
        configImported: true,
        stateImported: true,
      })

      const req = new Request('http://localhost/opencode-import?userId=default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overwriteState: true }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.serverRestarted).toBe(true)
      expect(mockSyncOpenCodeImport).toHaveBeenCalledWith({
        overwriteState: true,
        protectExistingState: true,
        settingsService: expect.anything(),
      })
      expect(mockGetImportedSessionDirectories).toHaveBeenCalledWith('/tmp/test-workspace/.opencode/state/opencode')
      expect(mockRelinkReposFromSessionDirectories).toHaveBeenCalled()
      expect(mockClearStartupError).toHaveBeenCalled()
      expect(mockRestart).toHaveBeenCalled()
    })

    it('should return 404 when no importable host data exists', async () => {
      mockSyncOpenCodeImport.mockResolvedValueOnce({
        configSourcePath: null,
        stateSourcePath: null,
        workspaceConfigPath: '/tmp/test-workspace/.config/opencode/opencode.json',
        workspaceStatePath: '/tmp/test-workspace/.opencode/state/opencode',
        workspaceStateExists: true,
        configImported: false,
        stateImported: false,
      })

      const req = new Request('http://localhost/opencode-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overwriteState: true }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(404)
      expect(json.error).toBe('No importable OpenCode host data found')
      expect(mockRestart).not.toHaveBeenCalled()
    })

    it('should return 409 when import is blocked to protect workspace state', async () => {
      mockSyncOpenCodeImport.mockRejectedValueOnce(
        new OpenCodeImportProtectionError('Workspace state already exists and must be cleared before import')
      )

      const req = new Request('http://localhost/opencode-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(409)
      expect(json.error).toBe('OpenCode host import was blocked to protect existing workspace state')
      expect(json.code).toBe('OPENCODE_IMPORT_PROTECTED')
      expect(json.detail).toBe('Workspace state already exists and must be cleared before import')
      expect(mockRestart).not.toHaveBeenCalled()
    })

    it('should not call relink functions when only config is imported (stateImported: false)', async () => {
      mockSyncOpenCodeImport.mockResolvedValueOnce({
        configSourcePath: '/import/opencode-config/opencode.json',
        stateSourcePath: '/import/opencode-state',
        workspaceConfigPath: '/tmp/test-workspace/.config/opencode/opencode.json',
        workspaceStatePath: '/tmp/test-workspace/.opencode/state/opencode',
        workspaceStateExists: false,
        configImported: true,
        stateImported: false,
      })

      const req = new Request('http://localhost/opencode-import?userId=default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overwriteState: true }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.serverRestarted).toBe(true)
      expect(json.configImported).toBe(true)
      expect(json.stateImported).toBe(false)
      expect(mockGetImportedSessionDirectories).not.toHaveBeenCalled()
      expect(mockRelinkReposFromSessionDirectories).not.toHaveBeenCalled()
      expect(mockClearStartupError).toHaveBeenCalled()
      expect(mockRestart).toHaveBeenCalled()
      expect(json.relinkedRepos).toEqual({
        repos: [],
        relinkedCount: 0,
        existingCount: 0,
        nonRepoPathCount: 0,
        duplicatePathCount: 0,
        errors: [],
      })
    })
  })

  describe('POST /opencode-upgrade', () => {
    describe('successful upgrade scenarios', () => {
      it('should upgrade OpenCode successfully and respond with success', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.1')
        mockSpawnSync.mockReturnValueOnce({ stdout: 'Upgrade successful\n', stderr: '', signal: null, status: 0, error: undefined })

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(res.status).toBe(200)
        expect(json.success).toBe(true)
        expect(json.upgraded).toBe(true)
        expect(json.oldVersion).toBe('1.0.0')
        expect(json.newVersion).toBe('1.0.1')
        expect(json.message).toBe('OpenCode upgraded from v1.0.0 to v1.0.1 and restarted')
      })

      it('should use a freshly fetched version and restart when the cached version is stale after upgrade', async () => {
        mockGetVersion.mockReturnValue('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.1')
        mockSpawnSync.mockReturnValueOnce({ stdout: 'Upgrade successful\n', stderr: '', signal: null, status: 0, error: undefined })

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(res.status).toBe(200)
        expect(json.upgraded).toBe(true)
        expect(json.newVersion).toBe('1.0.1')
        expect(mockFetchVersion).toHaveBeenCalledTimes(1)
        expect(mockRestart).toHaveBeenCalledTimes(1)
      })

      it('should return already up to date when version unchanged', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.0')
        mockSpawnSync.mockReturnValueOnce({ stdout: 'Already up to date\n', stderr: '', signal: null, status: 0, error: undefined })

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(res.status).toBe(200)
        expect(json.success).toBe(true)
        expect(json.upgraded).toBe(false)
        expect(json.message).toContain('already up to date')
        expect(mockFetchVersion).toHaveBeenCalledTimes(1)
      })

      it('should restart directly after a successful upgrade', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.1')
        mockSpawnSync.mockReturnValueOnce({ stdout: 'Upgrade successful\n', stderr: '', signal: null, status: 0, error: undefined })

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        await settingsApp.fetch(req)

        expect(mockRestart).toHaveBeenCalledTimes(1)
      })

    })

    describe('timeout and recovery scenarios', () => {
      it('should timeout after 90 seconds and attempt server recovery', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
          .mockReturnValueOnce('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.0')
        mockSpawnSync.mockReturnValueOnce({ stdout: '', stderr: '', signal: 'SIGKILL', status: null, error: undefined })

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(mockSpawnSync).toHaveBeenCalledWith(
          'opencode',
          ['upgrade', '--method', 'curl'],
          expect.objectContaining({
            timeout: 90000,
            killSignal: 'SIGKILL'
          })
        )
        expect(mockClearStartupError).toHaveBeenCalled()
        expect(mockRestart).toHaveBeenCalled()
        expect(res.status).toBe(400)
        expect(json).toMatchObject({
          upgraded: false,
          recovered: true,
          oldVersion: '1.0.0',
          newVersion: '1.0.0'
        })
        expect(json.error).toContain('recovered')
      })

      it('should attempt recovery when upgrade command throws non-timeout error', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
          .mockReturnValueOnce('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.0')
        mockSpawnSync.mockReturnValueOnce({ stdout: '', stderr: 'Network error', signal: null, status: 1, error: undefined })

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(mockClearStartupError).toHaveBeenCalled()
        expect(mockRestart).toHaveBeenCalled()
        expect(res.status).toBe(400)
        expect(json.recovered).toBe(true)
      })

      it('should return 500 when recovery fails', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
          .mockReturnValueOnce('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.0')
        mockSpawnSync.mockReturnValueOnce({ stdout: '', stderr: 'Upgrade failed', signal: null, status: 1, error: undefined })
        mockRestart.mockRejectedValueOnce(new Error('Restart failed'))

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(res.status).toBe(500)
        expect(json.recovered).toBe(false)
      })
    })

    describe('version handling', () => {
      it('should use fetched version when getVersion returns null', async () => {
        mockGetVersion.mockReturnValueOnce(null)
        mockFetchVersion.mockResolvedValueOnce('1.0.1')
        mockSpawnSync.mockReturnValueOnce({ stdout: 'Upgrade successful\n', stderr: '', signal: null, status: 0, error: undefined })

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(mockFetchVersion).toHaveBeenCalled()
        expect(json.oldVersion).toBe(null)
        expect(json.newVersion).toBe('1.0.1')
      })

      it('should handle both getVersion and fetchVersion returning null', async () => {
        mockGetVersion.mockReturnValueOnce(null)
        mockFetchVersion.mockResolvedValueOnce(null)
        mockSpawnSync.mockReturnValueOnce({ stdout: 'Upgrade successful\n', stderr: '', signal: null, status: 0, error: undefined })

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(json.upgraded).toBe(false)
      })
    })
  })

  describe('POST /opencode-install-version', () => {
    describe('successful installation', () => {
      it('should install specific version successfully', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.5')
        mockSpawnSync.mockReturnValueOnce({ stdout: 'Installed v1.0.5\n', stderr: '', signal: null, status: 0, error: undefined })

        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: '1.0.5' }),
          headers: { 'Content-Type': 'application/json' }
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(res.status).toBe(200)
        expect(json.success).toBe(true)
        expect(json.newVersion).toBe('1.0.5')
      })

      it('does not report success when the requested version was not installed', async () => {
        mockGetVersion.mockReturnValue('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.0')
        mockSpawnSync.mockReturnValueOnce({ stdout: 'Installed v1.0.5\n', stderr: '', signal: null, status: 0, error: undefined })

        const res = await settingsApp.fetch(new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: '1.0.5' }),
          headers: { 'Content-Type': 'application/json' }
        }))
        const json = await res.json() as Record<string, unknown>

        expect(res.status).toBe(400)
        expect(json.success).toBe(false)
        expect(json.details).toContain('did not result in the requested version 1.0.5')
        expect(json.newVersion).toBe('1.0.0')
      })

      it('should prepend v to version if missing', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.5')
        mockSpawnSync.mockReturnValueOnce({ stdout: 'Installed v1.0.5\n', stderr: '', signal: null, status: 0, error: undefined })

        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: '1.0.5' }),
          headers: { 'Content-Type': 'application/json' }
        })
        await settingsApp.fetch(req)

        expect(mockSpawnSync).toHaveBeenCalledWith(
          'opencode',
          ['upgrade', 'v1.0.5', '--method', 'curl'],
          expect.any(Object)
        )
      })

      it('should not double prepend v to version', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.5')
        mockSpawnSync.mockReturnValueOnce({ stdout: 'Installed v1.0.5\n', stderr: '', signal: null, status: 0, error: undefined })

        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: 'v1.0.5' }),
          headers: { 'Content-Type': 'application/json' }
        })
        await settingsApp.fetch(req)

        expect(mockSpawnSync).toHaveBeenCalledWith(
          'opencode',
          ['upgrade', 'v1.0.5', '--method', 'curl'],
          expect.any(Object)
        )
      })
    })

    describe('timeout and recovery', () => {
      it('should timeout and recover on version install', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
          .mockReturnValueOnce('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.0')
        mockSpawnSync.mockReturnValueOnce({ stdout: '', stderr: '', signal: 'SIGKILL', error: undefined })

        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: '1.0.5' }),
          headers: { 'Content-Type': 'application/json' }
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(mockSpawnSync).toHaveBeenCalledWith(
          'opencode',
          ['upgrade', 'v1.0.5', '--method', 'curl'],
          expect.any(Object)
        )
        expect(mockRestart).toHaveBeenCalled()
        expect(res.status).toBe(400)
        expect(json.recovered).toBe(true)
      })
    })

    describe('validation', () => {
      it('should reject empty version', async () => {
        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: '' }),
          headers: { 'Content-Type': 'application/json' }
        })
        const res = await settingsApp.fetch(req)

        expect(res.status).toBe(400)
      })

      it('should reject missing version', async () => {
        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' }
        })
        const res = await settingsApp.fetch(req)

        expect(res.status).toBe(400)
      })

      it('should reject invalid version format with command injection attempt', async () => {
        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: '1.2.27; cat /etc/passwd; #' }),
          headers: { 'Content-Type': 'application/json' }
        })
        const res = await settingsApp.fetch(req)

        expect(res.status).toBe(400)
      })

      it('should reject version with invalid format', async () => {
        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: 'invalid' }),
          headers: { 'Content-Type': 'application/json' }
        })
        const res = await settingsApp.fetch(req)

        expect(res.status).toBe(400)
      })
    })
  })

  describe('error scenarios - server stability', () => {
    it('should not crash when upgrade command throws unexpected error', async () => {
      mockGetVersion.mockReturnValueOnce('1.0.0')
          .mockReturnValue('1.0.0')
      mockFetchVersion.mockResolvedValueOnce('1.0.0')
      mockSpawnSync.mockReturnValueOnce({ stdout: '', stderr: 'Unexpected error', signal: null, status: 1, error: undefined })
      mockRestart.mockResolvedValue(undefined)

      const req = new Request('http://localhost/opencode-upgrade', {
        method: 'POST'
      })
      const res = await settingsApp.fetch(req)

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toBeDefined()
    })

    it('should not crash when getVersion throws error during failure recovery', async () => {
      mockGetVersion.mockImplementationOnce(() => '1.0.0')
          .mockImplementationOnce(() => {
            throw new Error('GetVersion failed')
          })
      mockFetchVersion.mockResolvedValueOnce('1.0.0')
      mockSpawnSync.mockReturnValueOnce({ stdout: '', stderr: 'Upgrade failed', signal: null, status: 1, error: undefined })
      mockRestart.mockResolvedValue(undefined)

      const req = new Request('http://localhost/opencode-upgrade', {
        method: 'POST'
      })
      const res = await settingsApp.fetch(req)

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toBeDefined()
    })

    it('should handle fetchVersion throwing error during normal upgrade', async () => {
      mockGetVersion.mockReturnValueOnce('1.0.0')
        .mockReturnValueOnce('1.0.0')
      mockFetchVersion.mockRejectedValueOnce(new Error('Fetch version failed'))
      mockSpawnSync.mockReturnValueOnce({ stdout: 'Upgrade successful\n', stderr: '', signal: null, status: 0, error: undefined })

      const req = new Request('http://localhost/opencode-upgrade', {
        method: 'POST'
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(400)
      expect(json.recovered).toBe(true)
      expect(mockRestart).toHaveBeenCalledTimes(1)
    })

    it('should not leave server in broken state when upgrade times out', async () => {
      mockGetVersion.mockReturnValueOnce('1.0.0')
          .mockReturnValueOnce('1.0.0')
      mockFetchVersion.mockResolvedValueOnce('1.0.0')
      
      mockSpawnSync.mockReturnValueOnce({ stdout: '', stderr: '', signal: 'SIGKILL', status: null, error: undefined })
      mockRestart.mockResolvedValue(undefined)

      const req = new Request('http://localhost/opencode-upgrade', {
        method: 'POST'
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(mockClearStartupError).toHaveBeenCalled()
      expect(mockRestart).toHaveBeenCalled()
      expect(json.recovered).toBe(true)
    })
  })

  describe('POST /opencode-reload', () => {
    const validConfigFile = {
      path: '/tmp/test-workspace/.config/opencode.json',
      content: {},
      rawContent: '{}',
      isValid: true,
      updatedAt: 1,
    }

    beforeEach(() => {
      vi.clearAllMocks()
      setOpenCodeRestartCoordinator(null)
      mockReadOpenCodeConfigFile.mockReset()
      mockRestart.mockReset()
      mockClearStartupError.mockReset()
      mockRestart.mockResolvedValue(undefined)
      mockClearStartupError.mockReturnValue(undefined)
    })

    it('should return success and restart the server when the config is valid', async () => {
      mockReadOpenCodeConfigFile.mockResolvedValueOnce(validConfigFile)

      const req = new Request('http://localhost/opencode-reload', {
        method: 'POST'
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.message).toBe('OpenCode server restarted with the current configuration')
      expect(json.resumedSessions).toEqual([])
      expect(mockRestart).toHaveBeenCalledTimes(1)
      expect(mockClearStartupError).toHaveBeenCalled()
    })

    it('should propagate validationIssues and not restart when the config is invalid', async () => {
      const validationIssues = [
        { path: 'command.review', message: 'Invalid field' },
        { path: 'agent.temperature', message: 'Temperature out of range' }
      ]

      mockReadOpenCodeConfigFile.mockResolvedValueOnce({ ...validConfigFile, isValid: false, validationIssues })

      const req = new Request('http://localhost/opencode-reload', {
        method: 'POST'
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(500)
      expect(json.error).toBe('OpenCode global configuration is invalid')
      expect(json.details).toBe('command.review: Invalid field; agent.temperature: Temperature out of range')
      expect(json.validationIssues).toEqual(validationIssues)
      expect(mockRestart).not.toHaveBeenCalled()
    })

    it('should return 500 and not restart when every global config source is absent', async () => {
      mockReadOpenCodeConfigFile.mockResolvedValueOnce(null)

      const req = new Request('http://localhost/opencode-reload', {
        method: 'POST'
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(500)
      expect(json.error).toBe('No OpenCode global configuration files found')
      expect(json.details).toBe('No OpenCode global configuration files found')
      expect(mockRestart).not.toHaveBeenCalled()
    })

    it('should return generic error when the restart fails', async () => {
      mockReadOpenCodeConfigFile.mockResolvedValueOnce(validConfigFile)
      mockRestart.mockRejectedValueOnce(new Error('Some other error'))

      const req = new Request('http://localhost/opencode-reload', {
        method: 'POST'
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(500)
      expect(json.error).toBe('Failed to reload OpenCode configuration')
      expect(json.details).toBe('Some other error')
    })

    it('returns 500 with the startup failure reason when a supervisor restart is unhealthy', async () => {
      mockReadOpenCodeConfigFile.mockResolvedValueOnce(validConfigFile)
      mockGetLastStartupError.mockReturnValue('OpenCode restart failed after recovery')
      const unhealthySupervisor = {
        restart: vi.fn().mockResolvedValue({ healthy: false }),
      }
      const app = createSettingsRoutes(
        testDb,
        { getGitEnvironment: vi.fn().mockReturnValue({}) } as any,
        createStubOpenCodeClient(),
        unhealthySupervisor as any,
      )

      const req = new Request('http://localhost/opencode-reload', { method: 'POST' })
      const res = await app.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(500)
      expect(json.success).toBeUndefined()
      expect(json.error).toBe('Failed to reload OpenCode configuration')
      expect(json.details).toBe('OpenCode restart failed after recovery')
      expect(unhealthySupervisor.restart).toHaveBeenCalledWith('settings_reload')
    })

    it('returns success when a supervisor restart is healthy', async () => {
      mockReadOpenCodeConfigFile.mockResolvedValueOnce(validConfigFile)
      const healthySupervisor = {
        restart: vi.fn().mockResolvedValue({ healthy: true }),
      }
      const app = createSettingsRoutes(
        testDb,
        { getGitEnvironment: vi.fn().mockReturnValue({}) } as any,
        createStubOpenCodeClient(),
        healthySupervisor as any,
      )

      const req = new Request('http://localhost/opencode-reload', { method: 'POST' })
      const res = await app.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(healthySupervisor.restart).toHaveBeenCalledWith('settings_reload')
    })
  })

  describe('POST /opencode-restart', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      mockRestart.mockReset()
      mockClearStartupError.mockReset()
      mockGetLastStartupError.mockReset()
      mockRestart.mockResolvedValue(undefined)
      mockClearStartupError.mockReturnValue(undefined)
    })

    it('returns 500 with the startup failure reason when a supervisor restart is unhealthy', async () => {
      mockGetLastStartupError.mockReturnValue('OpenCode version 1.18.15 is below the minimum required version 1.0.137')
      const unhealthySupervisor = {
        restart: vi.fn().mockResolvedValue({ healthy: false }),
      }
      const app = createSettingsRoutes(
        testDb,
        { getGitEnvironment: vi.fn().mockReturnValue({}) } as any,
        createStubOpenCodeClient(),
        unhealthySupervisor as any,
      )

      const req = new Request('http://localhost/opencode-restart', { method: 'POST' })
      const res = await app.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(500)
      expect(json.success).toBeUndefined()
      expect(json.error).toBe('Failed to restart OpenCode server')
      expect(json.details).toContain('is below the minimum required version 1.0.137')
      expect(unhealthySupervisor.restart).toHaveBeenCalledWith('settings_restart')
    })

    it('returns success when a supervisor restart is healthy', async () => {
      const healthySupervisor = {
        restart: vi.fn().mockResolvedValue({ healthy: true }),
      }
      const app = createSettingsRoutes(
        testDb,
        { getGitEnvironment: vi.fn().mockReturnValue({}) } as any,
        createStubOpenCodeClient(),
        healthySupervisor as any,
      )

      const req = new Request('http://localhost/opencode-restart', { method: 'POST' })
      const res = await app.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.message).toBe('OpenCode server restarted successfully')
      expect(json.resumedSessions).toEqual([])
    })

    it('returns 500 when a manager restart fails without a supervisor', async () => {
      mockRestart.mockRejectedValue(new Error('server failed to become healthy'))
      mockGetLastStartupError.mockReturnValue('server failed to become healthy')

      const req = new Request('http://localhost/opencode-restart', { method: 'POST' })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(500)
      expect(json.error).toBe('Failed to restart OpenCode server')
      expect(json.details).toBe('server failed to become healthy')
    })
  })

  describe('PATCH / - restart pending', () => {
    it('requires a restart when git credentials change instead of reloading config', async () => {
      const credential = { id: 'cred-1', name: 'gh', host: 'github.com', type: 'pat', token: 'new-token' }
      mockGetSettings.mockReturnValue({
        preferences: { gitCredentials: [{ ...credential, token: 'old-token' }] },
        updatedAt: 1,
      })
      mockUpdateSettings.mockReturnValue({
        preferences: { gitCredentials: [credential] },
        updatedAt: 2,
      })

      const req = new Request('http://localhost/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { gitCredentials: [credential] } }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.restartRequired).toBe(true)
      expect(opencodeServerManager.markRestartPending).toHaveBeenCalledTimes(1)
    })

    it('requires a restart when the git identity changes', async () => {
      mockGetSettings.mockReturnValue({
        preferences: { gitIdentity: { name: 'Old', email: 'old@example.com' } },
        updatedAt: 1,
      })
      mockUpdateSettings.mockReturnValue({
        preferences: { gitIdentity: { name: 'New', email: 'new@example.com' } },
        updatedAt: 2,
      })

      const req = new Request('http://localhost/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { gitIdentity: { name: 'New', email: 'new@example.com' } } }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.restartRequired).toBe(true)
      expect(opencodeServerManager.markRestartPending).toHaveBeenCalledTimes(1)
    })

    it('does not require a restart when git credentials are resubmitted unchanged', async () => {
      const credential = { id: 'cred-1', name: 'gh', host: 'github.com', type: 'pat', token: 'same-token' }
      mockGetSettings.mockReturnValue({
        preferences: { gitCredentials: [credential] },
        updatedAt: 1,
      })
      mockUpdateSettings.mockReturnValue({
        preferences: { gitCredentials: [credential] },
        updatedAt: 1,
      })

      const req = new Request('http://localhost/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { gitCredentials: [credential] } }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.restartRequired).toBeUndefined()
      expect(opencodeServerManager.markRestartPending).not.toHaveBeenCalled()
    })
  })

  describe('Settings Routes - manager token rotation', () => {
    let settingsApp: ReturnType<typeof createSettingsRoutes>
    let tokenDb: Database

    beforeEach(() => {
      vi.clearAllMocks()
      tokenDb = new Database(':memory:')
      migrate(tokenDb, allMigrations)
      settingsApp = createSettingsRoutes(
        tokenDb,
        { getGitEnvironment: vi.fn().mockReturnValue({}) } as any,
        createStubOpenCodeClient(),
      )
      mockRestart.mockResolvedValue(undefined)
      mockClearStartupError.mockReturnValue(undefined)
    })

    afterEach(() => {
      tokenDb.close()
    })

    it('rotates the caller own token without bouncing the OpenCode server', async () => {
      const previous = getOrCreateUserToken(tokenDb, 'default')

      const res = await settingsApp.fetch(new Request('http://localhost/manager-token/rotate', { method: 'POST' }))
      const json = await res.json() as { token: string; restartRequired: boolean }

      expect(res.status).toBe(200)
      expect(json.token).toBeDefined()
      expect(json.token).not.toBe(previous)
      // The old value was the OpenCode plugin's own credential, so replacing it
      // meant restarting the process that reads it. This one is a human's: only
      // that person's CLI has to re-pair, and restarting the server would be a
      // shared outage bought for a private change.
      expect(json.restartRequired).toBe(false)
      expect(opencodeServerManager.markRestartPending).not.toHaveBeenCalled()
    })

    it('does not mark the OpenCode server restart as pending when rotation fails', async () => {
      const brokenDb = {
        prepare: vi.fn(() => {
          throw new Error('database is unavailable')
        }),
      } as any
      settingsApp = createSettingsRoutes(
        brokenDb,
        { getGitEnvironment: vi.fn().mockReturnValue({}) } as any,
        createStubOpenCodeClient(),
      )

      const res = await settingsApp.fetch(new Request('http://localhost/manager-token/rotate', { method: 'POST' }))

      expect(res.status).toBe(500)
      expect(opencodeServerManager.markRestartPending).not.toHaveBeenCalled()
    })
  })
})

describe('Settings Routes - versions, directory files, skills, MCP and maintenance', () => {
  let app: Hono
  let db: Database
  let supervisor: { restart: ReturnType<typeof vi.fn> }
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockSpawnSync.mockReset()
    mockGetVersion.mockReset()
    mockFetchVersion.mockReset()
    mockRestart.mockReset()
    mockClearStartupError.mockReset()
    mockHasStoredOpenCodeServerPassword.mockReset()
    mockGetStoredOpenCodeServerPasswordState.mockReset()
    mockClearOpenCodeServerPassword.mockReset()
    mockSetOpenCodeServerPassword.mockReset()
    mockRestoreOpenCodeServerPasswordState.mockReset()
    mockListManagedSkills.mockReset()
    mockGetSkill.mockReset()
    mockCreateSkill.mockReset()
    mockUpdateSkill.mockReset()
    mockDeleteSkill.mockReset()
    mockInstallSkillFromGithubTree.mockReset()
    mockInstallSkillFromUploadedFiles.mockReset()
    mockInstallOpenCodeDirectoryFiles.mockReset()
    mockListOpenCodeDirectoryFiles.mockReset()
    mockGetOpenCodeDirectoryFile.mockReset()
    mockUpdateOpenCodeDirectoryFile.mockReset()
    mockDeleteOpenCodeDirectoryFile.mockReset()
    mockDiscoverModelsCached.mockReset()
    mockValidateSSHPrivateKey.mockReset()

    db = new Database(':memory:')
    migrate(db, allMigrations)
    supervisor = {
      restart: vi.fn().mockResolvedValue({ healthy: true, resumedSessionIDs: [] }),
    }
    // The session middleware that sets `user` in production is not mounted
    // here, and `/opencode-active-sessions` and `/skills` now refuse a request
    // with no principal rather than guessing one. Modelling the caller keeps
    // these cases describing the admin view they were written for; the
    // tenant-scoping rules live in `settings-tenant-scope.test.ts`.
    const routes = createSettingsRoutes(
      db,
      { getGitEnvironment: vi.fn().mockReturnValue({}) } as any,
      createStubOpenCodeClient(),
      supervisor as any,
    )
    app = new Hono()
    app.use('*', async (c, next) => {
      setUser(c, { id: 'default', role: 'admin', username: 'default' })
      await next()
    })
    app.route('/', routes)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    mockGetVersion.mockReturnValue('1.2.27')
    mockFetchVersion.mockResolvedValue('1.2.27')
    mockClearStartupError.mockReturnValue(undefined)
    mockSpawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' })
    mockValidateSSHPrivateKey.mockResolvedValue({ valid: true, hasPassphrase: false })
    mockHasStoredOpenCodeServerPassword.mockReturnValue(false)
    mockGetStoredOpenCodeServerPasswordState.mockReturnValue({ source: 'none' })
  })

  afterEach(() => {
    setOpenCodeRestartCoordinator(null)
    db.close()
    vi.unstubAllGlobals()
  })

  describe('GET /opencode-versions', () => {
    it('returns non-prerelease GitHub releases with the current version', async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify([
        { tag_name: 'v1.2.28', name: '1.2.28', published_at: '2026-01-01T00:00:00Z', prerelease: false },
        { tag_name: 'v1.3.0-beta.1', name: '1.3.0-beta.1', published_at: '2026-01-02T00:00:00Z', prerelease: true },
      ]), { status: 200 }))

      const res = await app.request(new Request('http://localhost/opencode-versions'))
      const json = await res.json() as { versions: Array<{ version: string; tag: string }>; currentVersion: string }

      expect(res.status).toBe(200)
      expect(json.currentVersion).toBe('1.2.27')
      expect(json.versions).toEqual([
        { version: '1.2.28', tag: 'v1.2.28', name: '1.2.28', publishedAt: '2026-01-01T00:00:00Z' },
      ])
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/sst/opencode/releases?per_page=20',
        { headers: expect.objectContaining({ Accept: 'application/vnd.github.v3+json' }) },
      )
    })

    it('returns 500 when the GitHub releases request fails', async () => {
      fetchMock.mockResolvedValue(new Response('rate limited', { status: 403 }))

      const res = await app.request(new Request('http://localhost/opencode-versions'))
      const json = await res.json() as { error: string; details: string }

      expect(res.status).toBe(500)
      expect(json.error).toBe('Failed to fetch versions')
      expect(json.details).toContain('403')
    })
  })

  describe('POST /opencode-install-version', () => {
    it('installs the requested version and restarts the server', async () => {
      mockFetchVersion.mockResolvedValue('1.2.28')

      const res = await app.request(new Request('http://localhost/opencode-install-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: '1.2.28' }),
      }))
      const json = await res.json() as { success: boolean; message: string; oldVersion: string; newVersion: string }

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.oldVersion).toBe('1.2.27')
      expect(json.newVersion).toBe('1.2.28')
      expect(json.message).toContain('changed from v1.2.27 to v1.2.28')
      expect(supervisor.restart).toHaveBeenCalledTimes(1)
      expect(mockSpawnSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['upgrade', 'v1.2.28']),
        expect.objectContaining({ timeout: 90000 }),
      )
    })

    it('returns 500 without recovery when the version install fails and the server cannot be recovered', async () => {
      mockFetchVersion.mockResolvedValue('1.2.29')
      supervisor.restart.mockResolvedValue({ healthy: false, resumedSessionIDs: [] })

      const res = await app.request(new Request('http://localhost/opencode-install-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: '1.2.28' }),
      }))
      const json = await res.json() as { recovered: boolean; newVersion: string }

      expect(res.status).toBe(500)
      expect(json.recovered).toBe(false)
      expect(json.newVersion).toBe('1.2.27')
    })
  })

  describe('OpenCode directory file routes', () => {
    it('lists directory files by kind', async () => {
      mockListOpenCodeDirectoryFiles.mockResolvedValue([
        { kind: 'agents', name: 'assistant', relativePath: 'assistant.md' },
      ])

      const res = await app.request(new Request('http://localhost/opencode-directory-files?kind=agents'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([
        { kind: 'agents', name: 'assistant', relativePath: 'assistant.md' },
      ])
      expect(mockListOpenCodeDirectoryFiles).toHaveBeenCalledWith('agents')
    })

    it('returns 400 when the directory file kind is invalid', async () => {
      const res = await app.request(new Request('http://localhost/opencode-directory-files?kind=unknown'))

      expect(res.status).toBe(400)
    })

    it('returns a directory file and its content', async () => {
      mockGetOpenCodeDirectoryFile.mockResolvedValue({
        kind: 'commands',
        name: 'review',
        relativePath: 'review.md',
        content: 'Review the changes',
      })

      const res = await app.request(new Request('http://localhost/opencode-directory-files/content?kind=commands&relativePath=review.md'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        kind: 'commands',
        name: 'review',
        relativePath: 'review.md',
        content: 'Review the changes',
      })
    })

    it('returns 404 when the directory file does not exist', async () => {
      mockGetOpenCodeDirectoryFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

      const res = await app.request(new Request('http://localhost/opencode-directory-files/content?kind=agents&relativePath=missing.md'))

      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'File not found' })
    })

    it('returns 400 when the content query is invalid', async () => {
      const res = await app.request(new Request('http://localhost/opencode-directory-files/content?kind=agents'))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Invalid request', details: expect.any(Array) })
    })

    it('updates a directory file and marks a restart pending', async () => {
      mockUpdateOpenCodeDirectoryFile.mockResolvedValue({
        kind: 'commands',
        name: 'review',
        relativePath: 'review.md',
      })

      const res = await app.request(new Request('http://localhost/opencode-directory-files', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'commands', relativePath: 'review.md', content: 'Updated' }),
      }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        kind: 'commands',
        name: 'review',
        relativePath: 'review.md',
        restartRequired: true,
      })
      expect(mockUpdateOpenCodeDirectoryFile).toHaveBeenCalledWith('commands', 'review.md', 'Updated')
      expect(opencodeServerManager.markRestartPending).toHaveBeenCalledTimes(1)
    })

    it('returns 400 when updating a directory file with an invalid body', async () => {
      const res = await app.request(new Request('http://localhost/opencode-directory-files', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'commands' }),
      }))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Invalid request', details: expect.any(Array) })
      expect(mockUpdateOpenCodeDirectoryFile).not.toHaveBeenCalled()
    })

    it('deletes a directory file and marks a restart pending', async () => {
      mockDeleteOpenCodeDirectoryFile.mockResolvedValue(undefined)

      const res = await app.request(new Request('http://localhost/opencode-directory-files?kind=agents&relativePath=assistant.md', {
        method: 'DELETE',
      }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ kind: 'agents', relativePath: 'assistant.md', restartRequired: true })
      expect(mockDeleteOpenCodeDirectoryFile).toHaveBeenCalledWith('agents', 'assistant.md')
      expect(opencodeServerManager.markRestartPending).toHaveBeenCalledTimes(1)
    })

    it('returns 400 when installing directory files without multipart form data', async () => {
      const res = await app.request(new Request('http://localhost/opencode-directory-files/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'agents' }),
      }))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Unsupported content type. Use multipart/form-data' })
    })

    it('installs uploaded directory files and marks a restart pending', async () => {
      mockInstallOpenCodeDirectoryFiles.mockResolvedValue({ kind: 'agents', filesInstalled: ['assistant.md'] })

      const formData = new FormData()
      formData.set('kind', 'agents')
      formData.set('fileManifest', JSON.stringify([{ fieldName: 'file0', relativePath: 'assistant.md' }]))
      formData.set('file0', new File(['# Assistant'], 'assistant.md', { type: 'text/markdown' }))

      const res = await app.request(new Request('http://localhost/opencode-directory-files/install', {
        method: 'POST',
        body: formData,
      }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        kind: 'agents',
        filesInstalled: ['assistant.md'],
        restartRequired: true,
      })
      expect(mockInstallOpenCodeDirectoryFiles).toHaveBeenCalledWith('agents', [
        { relativePath: 'assistant.md', content: expect.any(Buffer) },
      ])
      expect(opencodeServerManager.markRestartPending).toHaveBeenCalledTimes(1)
    })
  })

  describe('Skill routes', () => {
    it('lists managed skills', async () => {
      mockListManagedSkills.mockResolvedValue([
        { name: 'review', description: 'Review changes', body: 'body', scope: 'global', location: '/tmp/review' },
      ])

      const res = await app.request(new Request('http://localhost/skills'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([
        { name: 'review', description: 'Review changes', body: 'body', scope: 'global', location: '/tmp/review' },
      ])
      expect(mockListManagedSkills).toHaveBeenCalledWith(db, expect.anything(), undefined, undefined)
    })

    it('returns a skill by name and scope', async () => {
      mockGetSkill.mockResolvedValue({
        name: 'review',
        description: 'Review changes',
        body: 'body',
        scope: 'global',
        location: '/tmp/review',
      })

      const res = await app.request(new Request('http://localhost/skills/review?scope=global'))

      expect(res.status).toBe(200)
      expect(mockGetSkill).toHaveBeenCalledWith(db, expect.anything(), 'review', 'global', undefined)
    })

    it('returns 400 for an invalid skill scope', async () => {
      const res = await app.request(new Request('http://localhost/skills/review?scope=invalid'))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Invalid scope parameter. Must be "global" or "project"' })
    })

    it('returns 400 when a project skill is requested without a repoId', async () => {
      const res = await app.request(new Request('http://localhost/skills/review?scope=project'))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'repoId is required for project scope' })
    })

    it('returns 404 when the skill does not exist', async () => {
      mockGetSkill.mockRejectedValue(new Error('Skill not found'))

      const res = await app.request(new Request('http://localhost/skills/review?scope=global'))

      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Skill not found' })
    })

    it('creates a skill and marks a restart pending', async () => {
      mockCreateSkill.mockResolvedValue({
        name: 'review',
        description: 'Review changes',
        body: 'body',
        scope: 'global',
        location: '/tmp/review',
      })

      const res = await app.request(new Request('http://localhost/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'review', description: 'Review changes', body: 'body', scope: 'global' }),
      }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        name: 'review',
        description: 'Review changes',
        body: 'body',
        scope: 'global',
        location: '/tmp/review',
        restartRequired: true,
      })
      expect(opencodeServerManager.markRestartPending).toHaveBeenCalledTimes(1)
    })

    it('returns 409 when creating a skill that already exists', async () => {
      mockCreateSkill.mockRejectedValue(new Error('Skill already exists'))

      const res = await app.request(new Request('http://localhost/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'review', description: 'Review changes', body: 'body', scope: 'global' }),
      }))

      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: 'Skill already exists' })
    })

    it('updates a skill and marks a restart pending', async () => {
      mockUpdateSkill.mockResolvedValue({
        name: 'review',
        description: 'Updated',
        body: 'body',
        scope: 'global',
        location: '/tmp/review',
      })

      const res = await app.request(new Request('http://localhost/skills/review?scope=global', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Updated' }),
      }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        name: 'review',
        description: 'Updated',
        body: 'body',
        scope: 'global',
        location: '/tmp/review',
        restartRequired: true,
      })
      expect(opencodeServerManager.markRestartPending).toHaveBeenCalledTimes(1)
    })

    it('deletes a skill and marks a restart pending', async () => {
      mockDeleteSkill.mockResolvedValue(undefined)

      const res = await app.request(new Request('http://localhost/skills/review?scope=global', { method: 'DELETE' }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true, restartRequired: true })
      expect(mockDeleteSkill).toHaveBeenCalledWith(db, 'review', 'global', undefined)
      expect(opencodeServerManager.markRestartPending).toHaveBeenCalledTimes(1)
    })

    it('returns 400 when installing a project skill without a repoId', async () => {
      const res = await app.request(new Request('http://localhost/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceType: 'github', url: 'https://github.com/example/skill', scope: 'project' }),
      }))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'repoId is required for project scope' })
    })

    it('installs a global skill from a GitHub tree and marks a restart pending', async () => {
      mockInstallSkillFromGithubTree.mockResolvedValue({
        skill: { name: 'review', description: 'Review', body: 'body', scope: 'global', location: '/tmp/review' },
        overwritten: false,
        sourceType: 'github',
        filesInstalled: ['SKILL.md'],
      })

      const res = await app.request(new Request('http://localhost/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceType: 'github', url: 'https://github.com/example/skill', scope: 'global' }),
      }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        skill: { name: 'review', description: 'Review', body: 'body', scope: 'global', location: '/tmp/review' },
        overwritten: false,
        sourceType: 'github',
        filesInstalled: ['SKILL.md'],
        restartRequired: true,
      })
      expect(opencodeServerManager.markRestartPending).toHaveBeenCalledTimes(1)
    })

    it('reloads a project skill without restarting the whole server', async () => {
      const repo = createRepo(db, { localPath: 'project-repo', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
      mockInstallSkillFromGithubTree.mockResolvedValue({
        skill: { name: 'review', description: 'Review', body: 'body', scope: 'project', location: '/tmp/review', repoId: repo.id },
        overwritten: false,
        sourceType: 'github',
        filesInstalled: ['SKILL.md'],
      })

      const res = await app.request(new Request('http://localhost/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceType: 'github', url: 'https://github.com/example/skill', scope: 'project', repoId: repo.id }),
      }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        skill: { name: 'review', description: 'Review', body: 'body', scope: 'project', location: '/tmp/review', repoId: repo.id },
        overwritten: false,
        sourceType: 'github',
        filesInstalled: ['SKILL.md'],
        restartRequired: false,
      })
      expect(opencodeServerManager.markRestartPending).not.toHaveBeenCalled()
      expect(supervisor.restart).toHaveBeenCalledTimes(1)
      expect(mockInstallSkillFromGithubTree).toHaveBeenCalledWith(db, expect.objectContaining({ scope: 'project', repoId: repo.id }))
    })

    it('installs an uploaded skill from multipart form data', async () => {
      mockInstallSkillFromUploadedFiles.mockResolvedValue({
        skill: { name: 'review', description: 'Review', body: 'body', scope: 'global', location: '/tmp/review' },
        overwritten: false,
        sourceType: 'upload',
        filesInstalled: ['SKILL.md'],
      })

      const formData = new FormData()
      formData.set('scope', 'global')
      formData.set('fileManifest', JSON.stringify([{ fieldName: 'file0', relativePath: 'review/SKILL.md' }]))
      formData.set('file0', new File(['---\nname: review\ndescription: Review\n---\nbody'], 'SKILL.md', { type: 'text/markdown' }))

      const res = await app.request(new Request('http://localhost/skills/install', {
        method: 'POST',
        body: formData,
      }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        skill: { name: 'review', description: 'Review', body: 'body', scope: 'global', location: '/tmp/review' },
        overwritten: false,
        sourceType: 'upload',
        filesInstalled: ['SKILL.md'],
        restartRequired: true,
      })
      expect(mockInstallSkillFromUploadedFiles).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ sourceType: 'upload', scope: 'global' }),
        [{ relativePath: 'review/SKILL.md', content: expect.any(Buffer) }],
      )
    })

    it('returns 400 when installing a skill with an unsupported content type', async () => {
      const res = await app.request(new Request('http://localhost/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'not a skill',
      }))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Unsupported content type. Use application/json or multipart/form-data' })
    })
  })

  describe('POST /test-ssh', () => {
    it('returns 400 when the SSH key is invalid', async () => {
      mockValidateSSHPrivateKey.mockResolvedValue({ valid: false, hasPassphrase: false, error: 'Invalid SSH key' })

      const res = await app.request(new Request('http://localhost/test-ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'example.com', sshPrivateKey: 'not-a-key' }),
      }))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ success: false, message: 'Invalid SSH key' })
    })

    it('reports a successful SSH authentication', async () => {
      mockSpawnSync.mockReturnValue({ status: 255, stdout: '', stderr: "debug1: Authentication succeeded\nYou've successfully authenticated" })

      const res = await app.request(new Request('http://localhost/test-ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'git@example.com:2222', sshPrivateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----' }),
      }))

      expect(res.status).toBe(200)
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'ssh',
        expect.arrayContaining(['-p', '2222', 'git@example.com']),
        expect.objectContaining({ timeout: 30000 }),
      )
    })

    it('reports a timeout when the SSH command is killed', async () => {
      mockSpawnSync.mockReturnValue({ status: null, signal: 'SIGKILL', stdout: '', stderr: '' })

      const res = await app.request(new Request('http://localhost/test-ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'example.com', sshPrivateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----' }),
      }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        success: false,
        message: 'Connection timed out. This may indicate a network issue or an incorrect host.',
      })
    })

    it('reports permission denied, unknown host, and refused connection details', async () => {
      const cases = [
        { output: 'Permission denied (publickey)', message: 'Permission denied. The SSH key may not be authorized on this host, or the passphrase is incorrect.' },
        { output: 'Could not resolve hostname example.com', message: 'Could not resolve hostname. Please check that the host is correct and accessible.' },
        { output: 'ssh: connect to host example.com port 22: Connection refused', message: 'Connection refused or timed out. The host may be down or not accepting SSH connections.' },
      ]

      for (const testCase of cases) {
        mockSpawnSync.mockReturnValue({ status: 255, stdout: '', stderr: testCase.output })

        const res = await app.request(new Request('http://localhost/test-ssh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: 'example.com', sshPrivateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----' }),
        }))

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ success: false, message: testCase.message })
      }
    })

    it('reports ambiguous SSH output and uses sshpass when a passphrase is provided', async () => {
      mockSpawnSync.mockReturnValue({ status: 255, stdout: '', stderr: 'debug1: no matching host key' })

      const res = await app.request(new Request('http://localhost/test-ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'example.com', sshPrivateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----', passphrase: 'secret' }),
      }))

      expect(res.status).toBe(200)
      const json = await res.json() as { success: boolean; message: string }
      expect(json.success).toBe(false)
      expect(json.message).toContain('Authentication failed')
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'sshpass',
        expect.arrayContaining(['-e', 'ssh']),
        expect.objectContaining({ env: expect.objectContaining({ SSHPASS: 'secret' }) }),
      )
    })

    it('returns 400 for an invalid test-ssh body', async () => {
      const res = await app.request(new Request('http://localhost/test-ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'example.com' }),
      }))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Invalid request data', details: expect.any(Array) })
    })
  })

  describe('MCP directory routes', () => {
    function createMcpApp(forward: ReturnType<typeof vi.fn>) {
      return createSettingsRoutes(
        db,
        { getGitEnvironment: vi.fn().mockReturnValue({}) } as any,
        createStubOpenCodeClient({ forward: forward as any }),
        supervisor as any,
      )
    }

    it('connects an MCP server for a directory', async () => {
      const forward = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
      const mcpApp = createMcpApp(forward)

      const res = await mcpApp.request(new Request('http://localhost/mcp/context7/connectdirectory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: '/tmp/project' }),
      }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
      expect(forward).toHaveBeenCalledWith({
        method: 'POST',
        path: '/mcp/context7/connect',
        directory: '/tmp/project',
      })
    })

    it('returns 400 with the OpenCode error when connecting fails', async () => {
      const forward = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'MCP server unreachable' }), { status: 502 }))
      const mcpApp = createMcpApp(forward)

      const res = await mcpApp.request(new Request('http://localhost/mcp/context7/connectdirectory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: '/tmp/project' }),
      }))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'MCP server unreachable' })
    })

    it('disconnects an MCP server and removes MCP auth', async () => {
      const forward = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
      const mcpApp = createMcpApp(forward)

      const disconnectRes = await mcpApp.request(new Request('http://localhost/mcp/context7/disconnectdirectory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: '/tmp/project' }),
      }))
      expect(disconnectRes.status).toBe(200)

      const authRes = await mcpApp.request(new Request('http://localhost/mcp/context7/authdirectedir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: '/tmp/project' }),
      }))
      expect(authRes.status).toBe(200)
      expect(await authRes.json()).toEqual({})

      const deleteRes = await mcpApp.request(new Request('http://localhost/mcp/context7/authdir', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: '/tmp/project' }),
      }))
      expect(deleteRes.status).toBe(200)
      expect(await deleteRes.json()).toEqual({ success: true })

      expect(forward).toHaveBeenCalledTimes(3)
    })

    it('returns 400 for invalid MCP directory bodies', async () => {
      const forward = vi.fn()
      const mcpApp = createMcpApp(forward)

      const res = await mcpApp.request(new Request('http://localhost/mcp/context7/connectdirectory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: '' }),
      }))

      expect(res.status).toBe(400)
      expect(forward).not.toHaveBeenCalled()
    })
  })

  describe('OpenCode server auth routes', () => {
    it('reports the configured source for the server password', async () => {
      mockHasStoredOpenCodeServerPassword.mockReturnValue(false)

      const res = await app.request(new Request('http://localhost/opencode-server-auth'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ isSet: false, source: 'none' })
    })

    it('clears the server password and reconnects the SSE aggregator', async () => {
      mockGetStoredOpenCodeServerPasswordState.mockReturnValue({ source: 'db' })

      const res = await app.request(new Request('http://localhost/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: null }),
      }))

      expect(res.status).toBe(200)
      expect(mockClearOpenCodeServerPassword).toHaveBeenCalledTimes(1)
      expect(mockSetOpenCodeServerPassword).not.toHaveBeenCalled()
      expect(await res.json()).toEqual({ isSet: false, source: 'none' })
    })

    it('restores the previous password state when the restart fails', async () => {
      mockGetStoredOpenCodeServerPasswordState.mockReturnValue({ source: 'db' })
      supervisor.restart.mockResolvedValue({ healthy: false, resumedSessionIDs: [] })

      const res = await app.request(new Request('http://localhost/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'new-password' }),
      }))

      expect(res.status).toBe(500)
      expect(mockSetOpenCodeServerPassword).toHaveBeenCalledWith('new-password')
      expect(mockRestoreOpenCodeServerPasswordState).toHaveBeenCalledWith({ source: 'db' })
      expect(await res.json()).toEqual({ error: 'Failed to update OpenCode server auth' })
    })
  })

  /**
   * The property that replaced the old one.
   *
   * Before, every signed-in user was handed the same value, because it was one
   * value: the plugin's. A test that only checks "a token comes back" passes
   * either way - it cannot tell a per-user token from a global one - so these
   * check the difference between two callers directly, and check that the
   * plugin's own credential is never what the page returns.
   */
/**
 * A bare `Hono` has no variable map, so its `set` only accepts `never`. The
 * application reaches `user` on the context through the same cast the routes
 * use; this is the way in.
 */
function setUser(c: Context, user: { id: string; role: 'admin' | 'user'; username?: string | null }): void {
  (c as unknown as { set: (key: string, value: unknown) => void }).set('user', user)
}

  describe('Settings Routes - the token panel is per user', () => {
    let tokenDb: Database
    let routes: ReturnType<typeof createSettingsRoutes>

    const asUser = (id: string) => {
      const wrapper = new Hono()
      wrapper.use('*', async (c, next) => {
        setUser(c, { id, role: 'user', username: id })
        await next()
      })
      wrapper.route('/', routes)
      return wrapper
    }

    const addUser = (id: string) => {
      const now = Date.now()
      tokenDb.prepare(
        `INSERT INTO "user" ("id", "name", "email", "username", "role", "emailVerified", "createdAt", "updatedAt")
         VALUES (?, ?, ?, ?, 'user', 0, ?, ?)`,
      ).run(id, id, `${id}@example.test`, id, now, now)
    }

    beforeEach(() => {
      vi.clearAllMocks()
      tokenDb = new Database(':memory:')
      migrate(tokenDb, allMigrations)
      routes = createSettingsRoutes(
        tokenDb,
        { getGitEnvironment: vi.fn().mockReturnValue({}) } as any,
        createStubOpenCodeClient(),
      )
      addUser('u-alice')
      addUser('u-bob')
    })

    afterEach(() => {
      tokenDb.close()
    })

    it('gives two different callers two different tokens', async () => {
      const alice = await (await asUser('u-alice').request(new Request('http://localhost/manager-token'))).json() as { token: string }
      const bob = await (await asUser('u-bob').request(new Request('http://localhost/manager-token'))).json() as { token: string }

      expect(alice.token).toBeTruthy()
      expect(bob.token).toBeTruthy()
      expect(alice.token).not.toBe(bob.token)
    })

    it('never returns the shared plugin token', async () => {
      // The whole reason this route changed. Asserting it directly is the only
      // way a future refactor that reaches for the global secret fails here
      // rather than in production.
      const shared = getOrCreateInternalToken(tokenDb)
      const json = await (await asUser('u-alice').request(new Request('http://localhost/manager-token'))).json() as { token: string }

      expect(json.token).not.toBe(shared)
    })

    it('is stable across reads, so a CLI does not have to re-pair on every call', async () => {
      const first = await (await asUser('u-alice').request(new Request('http://localhost/manager-token'))).json() as { token: string }
      const second = await (await asUser('u-alice').request(new Request('http://localhost/manager-token'))).json() as { token: string }

      expect(second.token).toBe(first.token)
    })

    it('rotates one caller without touching the other', async () => {
      const before = await (await asUser('u-bob').request(new Request('http://localhost/manager-token'))).json() as { token: string }
      const alice = await (await asUser('u-alice').request(new Request('http://localhost/manager-token'))).json() as { token: string }
      const rotated = await (await asUser('u-alice').request(new Request('http://localhost/manager-token/rotate', { method: 'POST' }))).json() as { token: string }
      const bob = await (await asUser('u-bob').request(new Request('http://localhost/manager-token'))).json() as { token: string }

      expect(rotated.token).not.toBe(alice.token)
      expect(bob.token).toBe(before.token)
    })

    it('stops honouring the previous value after a rotation', async () => {
      // Rotation is only worth anything if the old token stops working. Asserted
      // through the real lookup rather than by reading the table, so a bug that
      // left the old row behind would still fail.
      const first = await (await asUser('u-alice').request(new Request('http://localhost/manager-token'))).json() as { token: string }
      await asUser('u-alice').request(new Request('http://localhost/manager-token/rotate', { method: 'POST' }))

      expect(findUserIdByToken(tokenDb, first.token)).toBeNull()
    })
  })

  describe('Maintenance routes', () => {
    it('returns the caller own token', async () => {
      const res = await app.request(new Request('http://localhost/manager-token'))

      expect(res.status).toBe(200)
      const json = await res.json() as { token: string }
      expect(json.token).toBe(getOrCreateUserToken(db, 'default'))
    })

    it('returns 500 when the manager token cannot be read', async () => {
      const brokenDb = {
        prepare: vi.fn(() => {
          throw new Error('database is unavailable')
        }),
      } as any
      const brokenApp = createSettingsRoutes(
        brokenDb,
        { getGitEnvironment: vi.fn().mockReturnValue({}) } as any,
        createStubOpenCodeClient(),
        supervisor as any,
      )

      const res = await brokenApp.request(new Request('http://localhost/manager-token'))

      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'Failed to get manager token' })
    })

    it('returns resumable sessions from the restart coordinator', async () => {
      setOpenCodeRestartCoordinator({
        captureResumableSessions: vi.fn().mockReturnValue([{ id: 'session-1' }]),
      } as any)

      const res = await app.request(new Request('http://localhost/opencode-active-sessions'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ count: 1, sessions: [{ id: 'session-1' }] })
    })

    it('returns an empty session list without a restart coordinator', async () => {
      const res = await app.request(new Request('http://localhost/opencode-active-sessions'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ count: 0, sessions: [] })
    })

    it('validates the model discovery baseUrl', async () => {
      const missing = await app.request(new Request('http://localhost/opencode-discover-models'))
      expect(missing.status).toBe(400)
      expect(await missing.json()).toEqual({ error: 'baseUrl is required' })

      const invalid = await app.request(new Request('http://localhost/opencode-discover-models?baseUrl=not-a-url'))
      expect(invalid.status).toBe(400)
      expect(await invalid.json()).toEqual({ error: 'Invalid baseUrl' })

      const nonHttp = await app.request(new Request('http://localhost/opencode-discover-models?baseUrl=ftp://example.com'))
      expect(nonHttp.status).toBe(400)
      expect(await nonHttp.json()).toEqual({ error: 'baseUrl must be an http or https URL' })
    })

    it('discovers and returns models with the cache flag', async () => {
      mockDiscoverModelsCached.mockResolvedValue({ models: [{ id: 'gpt-4' }], cached: false })

      const res = await app.request(new Request('http://localhost/opencode-discover-models?baseUrl=https://api.example.com&apiKey=secret&refresh=true'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ models: [{ id: 'gpt-4' }], cached: false })
      expect(mockDiscoverModelsCached).toHaveBeenCalledWith({
        baseUrl: 'https://api.example.com',
        apiKey: 'secret',
        type: 'opencode-models',
        filterPattern: /.*/,
        defaultModels: [],
        forceRefresh: true,
      })
    })

    it('returns 500 when model discovery fails', async () => {
      mockDiscoverModelsCached.mockRejectedValue(new Error('discovery failed'))

      const res = await app.request(new Request('http://localhost/opencode-discover-models?baseUrl=https://api.example.com'))

      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'Failed to discover models' })
    })
  })
})
