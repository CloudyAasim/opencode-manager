import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { SettingsService } from '../../src/services/settings'
import { CredentialProvider } from '../../src/services/credential-provider'
import { createRepo, setRepoGitCredentialId } from '../../src/db/queries'
import type { GitCredential } from '@opencode-manager/shared'

function createPatCredential(name: string, host: string, token: string, username?: string, id?: string): GitCredential {
  return {
    ...(id ? { id } : {}),
    name,
    host,
    token,
    ...(username ? { username } : {}),
  } as GitCredential
}

/** `basic <base64(user:token)>`, decoded back to the pair it stands for. */
function basicAuthPrincipal(env: Record<string, string>): string | null {
  for (const value of Object.values(env)) {
    const match = /basic\s+([A-Za-z0-9+/=]+)/.exec(value)
    if (match) return Buffer.from(match[1]!, 'base64').toString('utf8')
  }
  return null
}

function createSshCredential(name: string, host: string, sshPrivateKeyEncrypted?: string): GitCredential {
  return {
    name,
    host,
    type: 'ssh',
    ...(sshPrivateKeyEncrypted ? { sshPrivateKeyEncrypted } : {}),
  } as GitCredential
}

describe('CredentialProvider', () => {
  let db: Database
  let settingsService: SettingsService
  let provider: CredentialProvider

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    settingsService = new SettingsService(db)
    provider = new CredentialProvider(db)
  })

  /**
   * The keys a person saves under their own account have to be the keys their
   * own operations use. They were not: every read went to `'default'`, so a
   * saved key never took effect - the operation silently fell back to whatever
   * the host happened to have - and whatever sat in `'default'` was used by
   * every account.
   *
   * The tests above cannot have caught that. They call `updateSettings` with
   * no owner, which writes to `'default'`, which is the one namespace the old
   * read path happened to use. Every one of them passed while the per-user path
   * was broken - the same shape as the access guard that answered 500 because
   * its mock was the wrong shape.
   */
  describe('per-owner credentials', () => {
    const ownerPat = createPatCredential('owner-pat', 'github.com', 'ghp_owner', 'owner', 'cred-owner')
    const otherPat = createPatCredential('other-pat', 'github.com', 'ghp_other', 'other', 'cred-other')

    function seedRepo(userId: string, credentialId?: string): number {
      const repo = createRepo(db, {
        localPath: `/repos/${userId}/thing`,
        isLocal: true,
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
        userId,
      })
      if (credentialId) setRepoGitCredentialId(db, repo.id, credentialId)
      return repo.id
    }

    it("uses the repository owner's keys, not the process-wide ones", () => {
      settingsService.updateSettings({ gitCredentials: [ownerPat] }, 'user-a')
      settingsService.updateSettings({ gitCredentials: [otherPat] }, 'default')
      const repoId = seedRepo('user-a', 'cred-owner')

      // Decoded rather than string-matched: the value is `basic <base64>`, so
      // looking for the username in the raw env would pass or fail for a reason
      // unrelated to which credential was chosen.
      expect(basicAuthPrincipal(provider.getGitEnv({ repoId }))).toBe('owner:ghp_owner')
    })

    it("does not reach into another account's keys", () => {
      settingsService.updateSettings({ gitCredentials: [otherPat] }, 'user-b')
      const repoId = seedRepo('user-a', 'cred-owner')

      expect(provider.getGitCredentials({ repoId })).toEqual([])
    })

    it('falls back to the process-wide namespace for the server env', () => {
      settingsService.updateSettings({ gitCredentials: [otherPat] }, 'default')

      expect(provider.getGitCredentials()).toHaveLength(1)
    })

    it('attributes a first clone to the person who started it', () => {
      // No repository row exists yet at clone time, so the initiator is the
      // only honest answer to whose keys may be used.
      settingsService.updateSettings({ gitCredentials: [ownerPat] }, 'user-a')

      expect(provider.getSshCredentialsForHost('github.com', { userId: 'user-a' })).toEqual([])
      const [credential] = provider.getGitCredentials({ userId: 'user-a' })
      expect(credential).toMatchObject({ id: 'cred-owner', token: 'ghp_owner' })
    })
  })

  describe('with seeded credentials', () => {
    const githubPat: GitCredential = createPatCredential('github-pat', 'github.com', 'ghp_test_token')
    const gitlabPat: GitCredential = createPatCredential('gitlab-pat', 'gitlab.com', 'glpat_test_token', 'custom-user')
    const githubSsh: GitCredential = createSshCredential('github-ssh', 'github.com')

    beforeEach(() => {
      settingsService.updateSettings({ gitCredentials: [githubPat, gitlabPat, githubSsh] })
    })

    it('getPatCredentialForHost returns the matching PAT credential', () => {
      const result = provider.getPatCredentialForHost('github.com')
      expect(result).toEqual({ username: 'x-access-token', password: 'ghp_test_token' })
    })

    it('getPatCredentialForHost uses custom username when provided', () => {
      const result = provider.getPatCredentialForHost('gitlab.com')
      expect(result).toEqual({ username: 'custom-user', password: 'glpat_test_token' })
    })

    it('getPatCredentialForHost returns null for unmatched host', () => {
      expect(provider.getPatCredentialForHost('bitbucket.org')).toBeNull()
    })

    it('getPatCredentialForHost prefers the configured default PAT for the host', () => {
      const first = createPatCredential('first', 'github.com', 'first-token', undefined, 'first-id')
      const second = createPatCredential('second', 'github.com', 'second-token', undefined, 'second-id')
      settingsService.updateSettings({ gitCredentials: [first, second], defaultGitCredentialId: 'second-id' })

      expect(provider.getPatCredentialForHost('github.com')).toEqual({ username: 'x-access-token', password: 'second-token' })
    })

    it('getPatCredentialForHost prefers repo-specific PAT for the cwd', () => {
      const first = createPatCredential('first', 'github.com', 'first-token', undefined, 'first-id')
      const second = createPatCredential('second', 'github.com', 'second-token', undefined, 'second-id')
      settingsService.updateSettings({ gitCredentials: [first, second], defaultGitCredentialId: 'first-id' })
      const repo = createRepo(db, {
        repoUrl: 'https://github.com/acme/repo.git',
        localPath: 'repo',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
      })
      setRepoGitCredentialId(db, repo.id, 'second-id')

      expect(provider.getPatCredentialForHost('github.com', { cwd: repo.fullPath })).toEqual({ username: 'x-access-token', password: 'second-token' })
    })

    it('getPatCredentialForHost ignores selected credentials for other hosts', () => {
      const github = createPatCredential('github', 'github.com', 'github-token', undefined, 'github-id')
      const gitlab = createPatCredential('gitlab', 'gitlab.com', 'gitlab-token', 'custom-user', 'gitlab-id')
      settingsService.updateSettings({ gitCredentials: [github, gitlab], defaultGitCredentialId: 'github-id' })

      expect(provider.getPatCredentialForHost('gitlab.com')).toEqual({ username: 'custom-user', password: 'gitlab-token' })
    })

    it('getGhCliEnv returns GH_TOKEN and GITHUB_TOKEN for GitHub PAT', () => {
      const env = provider.getGhCliEnv()
      expect(env).toEqual({ GH_TOKEN: 'ghp_test_token', GITHUB_TOKEN: 'ghp_test_token' })
    })

    it('getGhCliEnv prefers the configured default GitHub PAT', () => {
      const first = createPatCredential('first', 'github.com', 'first-token', undefined, 'first-id')
      const second = createPatCredential('second', 'github.com', 'second-token', undefined, 'second-id')
      settingsService.updateSettings({ gitCredentials: [first, second], defaultGitCredentialId: 'second-id' })

      expect(provider.getGhCliEnv()).toEqual({ GH_TOKEN: 'second-token', GITHUB_TOKEN: 'second-token' })
    })

    it('getGhCliEnv prefers repo-specific GitHub PAT for the cwd', () => {
      const first = createPatCredential('first', 'github.com', 'first-token', undefined, 'first-id')
      const second = createPatCredential('second', 'github.com', 'second-token', undefined, 'second-id')
      settingsService.updateSettings({ gitCredentials: [first, second], defaultGitCredentialId: 'first-id' })
      const repo = createRepo(db, {
        repoUrl: 'https://github.com/acme/repo.git',
        localPath: 'repo',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
      })
      setRepoGitCredentialId(db, repo.id, 'second-id')

      expect(provider.getGhCliEnv({ cwd: repo.fullPath })).toEqual({ GH_TOKEN: 'second-token', GITHUB_TOKEN: 'second-token' })
    })

    it('getGitEnv returns git config env for configured PATs', () => {
      const env = provider.getGitEnv()
      expect(env.GIT_TERMINAL_PROMPT).toBe('0')
      expect(env.GIT_CONFIG_COUNT).toBe('2')
    })

    it('getSshCredentialsForHost returns SSH credentials and excludes PATs', () => {
      const sshCreds = provider.getSshCredentialsForHost('github.com')
      expect(sshCreds).toHaveLength(1)
      expect(sshCreds[0]).toMatchObject({ name: 'github-ssh', type: 'ssh' })
    })

    it('getSshCredentialsForHost returns empty array for unmatched host', () => {
      expect(provider.getSshCredentialsForHost('gitlab.com')).toEqual([])
    })

    it('getSshCredentialsWithPrivateKey returns only encrypted SSH credentials', () => {
      const encryptedSsh = createSshCredential('encrypted-ssh', 'example.com', 'encrypted-key')
      settingsService.updateSettings({ gitCredentials: [githubPat, githubSsh, encryptedSsh] })
      expect(provider.getSshCredentialsWithPrivateKey()).toEqual([encryptedSsh])
    })
  })

  describe('with no credentials', () => {
    it('getPatCredentialForHost returns null', () => {
      expect(provider.getPatCredentialForHost('github.com')).toBeNull()
    })

    it('getGhCliEnv returns empty object', () => {
      expect(provider.getGhCliEnv()).toEqual({})
    })

    it('getGitEnv returns disabled terminal prompt defaults', () => {
      expect(provider.getGitEnv()).toEqual({ GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '0' })
    })

    it('getSshCredentialsForHost returns empty array', () => {
      expect(provider.getSshCredentialsForHost('github.com')).toEqual([])
    })

    it('getSshCredentialsWithPrivateKey returns empty array', () => {
      expect(provider.getSshCredentialsWithPrivateKey()).toEqual([])
    })
  })

  describe('getGitCredentials', () => {
    it('returns empty array when no credentials are stored', () => {
      expect(provider.getGitCredentials()).toEqual([])
    })

    it('returns all stored credentials', () => {
      const creds = [createPatCredential('test', 'example.com', 'tok'), createSshCredential('ssh-test', 'example.com')]
      settingsService.updateSettings({ gitCredentials: creds })
      expect(provider.getGitCredentials()).toHaveLength(2)
    })
  })
})
