import type { Database } from 'bun:sqlite'
import type { GitCredential, Repo, UserPreferences } from '@opencode-manager/shared'
import { SettingsService } from './settings'
import {
  findPatCredentialForHost,
  getSSHCredentialsForHost,
  createGitEnv,
  createGhCliEnv,
  findGitHubCredential,
  type ResolvedGitCredential,
} from '../utils/git-auth'
import {
  getRepoByDirectory,
  getRepoGitCredentialId,
  listRepos,
} from '../db/queries'

interface CredentialResolutionOptions {
  cwd?: string
  repoId?: number
  /**
   * Who the operation is for, for the case where no repository row exists yet
   * - a first clone is initiated by a person, before there is a repo to own.
   */
  userId?: string | null
}

interface CredentialResolutionContext {
  preferences: UserPreferences
  credentials: GitCredential[]
  repo: Repo | null
}

export class CredentialProvider {
  private settingsService: SettingsService
  private database: Database

  constructor(database: Database) {
    this.database = database
    this.settingsService = new SettingsService(database)
  }

  /**
   * Whose settings a git operation may read credentials out of.
   *
   * A repository's owner configured its credential, so they are the only
   * honest answer to "whose keys may this operation use". Reading `'default'`
   * instead meant the opposite of both things that matter at once: the keys a
   * person saved under their own account were never the ones used for their
   * own clones - the operation silently fell back to whatever credentials the
   * host happened to have - and whatever did sit in `'default'` was used by
   * every account for every repository.
   *
   * `'default'` is kept for exactly one caller: building the OpenCode server's
   * own environment, which belongs to the process rather than to a tenant.
   */
  private settingsOwnerId(options: CredentialResolutionOptions, repo: Repo | null): string {
    return options.userId ?? repo?.userId ?? 'default'
  }

  getGitCredentials(options: CredentialResolutionOptions = {}): GitCredential[] {
    return this.getCredentials(this.getPreferences(options, this.resolveRepo(options)))
  }

  getGitCredentialById(
    credentialId: string | undefined,
    options: CredentialResolutionOptions = {},
  ): GitCredential | null {
    if (!credentialId) return null
    return this.getGitCredentials(options).find((credential) => credential.id === credentialId) ?? null
  }

  getPatCredentialForHost(hostname: string, options: CredentialResolutionOptions = {}): ResolvedGitCredential | null {
    const context = this.resolveContext(options)
    const selectedCredential = this.getSelectedCredential(context)
    const selectedMatch = selectedCredential ? findPatCredentialForHost([selectedCredential], hostname) : null
    return selectedMatch ?? findPatCredentialForHost(context.credentials, hostname)
  }

  getSshCredentialsForHost(host: string, options: CredentialResolutionOptions = {}): GitCredential[] {
    return getSSHCredentialsForHost(this.getGitCredentials(options), host)
  }

  getSshCredentialsWithPrivateKey(options: CredentialResolutionOptions = {}): GitCredential[] {
    return this.getGitCredentials(options).filter((cred) => cred.type === 'ssh' && cred.sshPrivateKeyEncrypted)
  }

  getGitEnv(options: CredentialResolutionOptions = {}): Record<string, string> {
    return this.getGitEnvForContext(this.resolveContext(options))
  }

  getGhCliEnv(options: CredentialResolutionOptions = {}): Record<string, string> {
    return this.getGhCliEnvForContext(this.resolveContext(options))
  }

  private resolveContext(options: CredentialResolutionOptions, repo = this.resolveRepo(options)): CredentialResolutionContext {
    const preferences = this.getPreferences(options, repo)
    return {
      preferences,
      credentials: this.getCredentials(preferences),
      repo,
    }
  }

  private getPreferences(options: CredentialResolutionOptions, repo: Repo | null): UserPreferences {
    return this.settingsService.getSettings(this.settingsOwnerId(options, repo)).preferences
  }

  private getCredentials(preferences: UserPreferences): GitCredential[] {
    return (preferences.gitCredentials || []) as GitCredential[]
  }

  private getGitEnvForContext(context: CredentialResolutionContext): Record<string, string> {
    return createGitEnv(context.credentials, this.getSelectedCredential(context))
  }

  private getGhCliEnvForContext(context: CredentialResolutionContext): Record<string, string> {
    const credential = this.getGhCliCredential(context)
    return createGhCliEnv(credential ? [credential] : [])
  }

  private resolveRepo(options: CredentialResolutionOptions): Repo | null {
    if (options.repoId !== undefined) {
      return listRepos(this.database).find((repo) => repo.id === options.repoId) ?? null
    }
    return options.cwd ? getRepoByDirectory(this.database, options.cwd) : null
  }

  private getGhCliCredential(context: CredentialResolutionContext): GitCredential | null {
    const selectedCredential = this.getSelectedCredential(context)
    if (this.isGithubPatCredential(selectedCredential)) return selectedCredential

    return findGitHubCredential(context.credentials)
  }

  private getSelectedCredential(context: CredentialResolutionContext): GitCredential | null {
    const repoCredential = this.getRepoCredential(context)
    if (repoCredential) return repoCredential

    return context.credentials.find((credential) => credential.id === context.preferences.defaultGitCredentialId) ?? null
  }

  private getRepoCredential(context: CredentialResolutionContext): GitCredential | null {
    if (!context.repo) return null

    const credentialId = getRepoGitCredentialId(this.database, context.repo.id)
    return context.credentials.find((credential) => credential.id === credentialId) ?? null
  }

  private isGithubPatCredential(credential: GitCredential | null): credential is GitCredential {
    return !!credential && credential.type !== 'ssh' && findGitHubCredential([credential]) === credential
  }
}
