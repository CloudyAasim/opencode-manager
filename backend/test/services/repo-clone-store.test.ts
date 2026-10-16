import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'

const mocks = vi.hoisted(() => ({
  executeCommand: vi.fn().mockResolvedValue(''),
  ensureDirectoryExists: vi.fn().mockResolvedValue(undefined),
  reposBase: vi.fn().mockReturnValue('/tmp/ocm-clone-store/repos'),
  setupSSHForRepoUrl: vi.fn().mockResolvedValue(undefined),
  getGitEnvironment: vi.fn().mockReturnValue({}),
  getSSHEnvironment: vi.fn().mockReturnValue({}),
  cleanupSSHKey: vi.fn().mockResolvedValue(undefined),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}))

vi.mock('../../src/utils/process', () => ({ executeCommand: mocks.executeCommand }))
vi.mock('../../src/services/file-operations', () => ({ ensureDirectoryExists: mocks.ensureDirectoryExists }))
vi.mock('../../src/services/repo-paths', () => ({ reposBase: mocks.reposBase }))
vi.mock('../../src/utils/logger', () => ({
  logger: { info: mocks.loggerInfo, error: mocks.loggerError, warn: mocks.loggerWarn, debug: vi.fn() },
}))

import { cloneRepo } from '../../src/services/repo/clone'
import type { GitAuthService } from '../../src/services/git-auth'

function gitAuthStub(): GitAuthService {
  return {
    setupSSHForRepoUrl: mocks.setupSSHForRepoUrl,
    getGitEnvironment: mocks.getGitEnvironment,
    getSSHEnvironment: mocks.getSSHEnvironment,
    cleanupSSHKey: mocks.cleanupSSHKey,
  } as unknown as GitAuthService
}

const CREDENTIALED_URL = 'https://alice:ghp_SECRET123@github.com/org/private-repo.git'

let db: Database

function storedRepoUrl(repoId: number): string {
  const row = db.prepare('SELECT repo_url FROM repos WHERE id = ?').get(repoId) as { repo_url: string }
  return row.repo_url
}

beforeEach(() => {
  vi.clearAllMocks()
  db = new Database(':memory:')
  migrate(db, allMigrations)
  mocks.executeCommand.mockResolvedValue('')
  mocks.reposBase.mockReturnValue('/tmp/ocm-clone-store/repos')
})

afterEach(() => {
  db.close()
})

describe('cloneRepo credential handling', () => {
  it('persists the repository URL without its embedded credentials', async () => {
    const repo = await cloneRepo(db, gitAuthStub(), CREDENTIALED_URL, { userId: 'u1' })

    expect(storedRepoUrl(repo.id)).toBe('https://github.com/org/private-repo')
    expect(storedRepoUrl(repo.id)).not.toContain('ghp_SECRET123')
  })

  it('still hands the credential-bearing URL to git', async () => {
    // The redaction is for storage and display only. A user who put the token in
    // the URL is relying on git receiving it, so this must not be stripped -
    // removing it would break the clone for anyone not using stored credentials.
    await cloneRepo(db, gitAuthStub(), CREDENTIALED_URL, { userId: 'u1' })

    const cloneCall = mocks.executeCommand.mock.calls.find(call => call[0]?.[0] === 'git' && call[0]?.[1] === 'clone')
    expect(cloneCall).toBeDefined()
    // Not the raw input: `normalizeRepoUrl` has already rewritten the scheme and
    // dropped `.git` by this point. What matters is that the credential is
    // still there.
    const clonedUrl = (cloneCall?.[0] ?? []).find(arg => typeof arg === 'string' && arg.includes('github.com')) as string
    expect(clonedUrl).toContain('ghp_SECRET123')
  })

  it('does not write the credentials to the logs', async () => {
    await cloneRepo(db, gitAuthStub(), CREDENTIALED_URL, { userId: 'u1' })

    const logged = [...mocks.loggerInfo.mock.calls, ...mocks.loggerError.mock.calls]
      .flat()
      .map(entry => (typeof entry === 'string' ? entry : ''))
      .join('\n')

    expect(logged.length).toBeGreaterThan(0)
    expect(logged).not.toContain('ghp_SECRET123')
  })

  it('returns the redacted URL on the repo it returns', async () => {
    const repo = await cloneRepo(db, gitAuthStub(), CREDENTIALED_URL, { userId: 'u1' })

    expect(repo.repoUrl).not.toContain('ghp_SECRET123')
  })
})
