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

  getGitCredentials(): GitCredential[] {
    return this.getCredentials(this.getPreferences())
  }

  getGitCredentialById(credentialId: string | undefined): GitCredential | null {
    if (!credentialId) return null
    return this.getGitCredentials().find((credential) => credential.id === credentialId) ?? null
  }

  getPatCredentialForHost(hostname: string, options: CredentialResolutionOptions = {}): ResolvedGitCredential | null {
    const context = this.resolveContext(options)
    const selectedCredential = this.getSelectedCredential(context)
    const selectedMatch = selectedCredential ? findPatCredentialForHost([selectedCredential], hostname) : null
    return selectedMatch ?? findPatCredentialForHost(context.credentials, hostname)
  }

  getSshCredentialsForHost(host: string): GitCredential[] {
    return getSSHCredentialsForHost(this.getGitCredentials(), host)
  }

  getSshCredentialsWithPrivateKey(): GitCredential[] {
    return this.getGitCredentials().filter((cred) => cred.type === 'ssh' && cred.sshPrivateKeyEncrypted)
  }

  getGitEnv(options: CredentialResolutionOptions = {}): Record<string, string> {
    return this.getGitEnvForContext(this.resolveContext(options))
  }

  getGhCliEnv(options: CredentialResolutionOptions = {}): Record<string, string> {
    return this.getGhCliEnvForContext(this.resolveContext(options))
  }

  private resolveContext(options: CredentialResolutionOptions, repo = this.resolveRepo(options)): CredentialResolutionContext {
    const preferences = this.getPreferences()
    return {
      preferences,
      credentials: this.getCredentials(preferences),
      repo,
    }
  }

  private getPreferences(): UserPreferences {
    return this.settingsService.getSettings('default').preferences
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
