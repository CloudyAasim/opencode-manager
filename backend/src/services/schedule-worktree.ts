import { existsSync } from 'node:fs'
import { NotFoundError } from '../utils/errors'
import path from 'path'
import type { Database } from 'bun:sqlite'
import { getScheduleWorktreesPath } from '@opencode-manager/shared/config/env'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import type { Repo } from '../types/repo'
import type { GitAuthService } from './git-auth'
import type { SettingsService } from './settings'
import type { CredentialProvider } from './credential-provider'
import type { OpenCodeClient } from './opencode/client'
import { resolveGitIdentity, createGitIdentityEnv } from '../utils/git-auth'
import { isSSHUrl } from '@opencode-manager/shared/utils'
import { executeCommand } from '../utils/process'
import { resolveDefaultBranch, createWorktreeSafely, removeWorktree } from './repo'
import { logger } from '../utils/logger'
import { mkdirSyncSafe } from '../utils/fs-safe'
import { swallow } from '../utils/swallow'

export interface ScheduleWorktreeContext {
  directory: string
  worktreePath: string
  runBranch: string
  workspaceId: string | null
}

export function buildRepoEnvForRepo(repo: { id?: number; fullPath: string }): Record<string, string> {
  return {
    ...(repo.id ? { OCM_GIT_REPO_ID: String(repo.id) } : {}),
    OCM_GIT_REPO_CWD: repo.fullPath,
  }
}

interface OpenCodeWorkspace {
  id: string
  directory: string
  branch: string | null
}

export class ScheduleWorktreeManager {
  constructor(
    private readonly gitAuthService: GitAuthService,
    private readonly settingsService: SettingsService,
    private readonly credentialProvider: CredentialProvider,
    private readonly db: Database,
    private readonly openCodeClient: OpenCodeClient,
  ) {}

  async prepare(
    repo: Repo,
    job: { id: number; branch: string | null },
    runId: number,
  ): Promise<ScheduleWorktreeContext | null> {
    if (repo.id === ASSISTANT_REPO_ID) return null

    try {
      await executeCommand(['git', '-C', repo.fullPath, 'rev-parse', '--is-inside-work-tree'], { silent: true })
    } catch {
      return null
    }

    let sshSetup = false
    if (repo.repoUrl && isSSHUrl(repo.repoUrl)) {
      await this.gitAuthService.setupSSHForRepoUrl(repo.repoUrl, this.db)
      sshSetup = true
    }

    try {
      const env = await this.buildGitEnv(repo, sshSetup, true)

      await executeCommand(['git', '-C', repo.fullPath, 'fetch', '--prune', 'origin'], { env }).catch(swallow)

      const base = job.branch?.trim() || (await resolveDefaultBranch(repo.fullPath, env))
      const baseRef = await this.resolveBaseRef(repo.fullPath, base, env)
      if (!baseRef) {
        throw new NotFoundError(`Base branch "${base}" was not found in this repository. Choose an existing branch in the schedule settings.`)
      }

      const runBranch = `schedule/${job.id}/run-${runId}`

      let createdWorkspace: OpenCodeWorkspace | null = null
      try {
        createdWorkspace = await this.openCodeClient.postJson<OpenCodeWorkspace>(
          '/experimental/workspace',
          { type: 'worktree', branch: null },
          { directory: repo.fullPath },
        )

        const workspaceDirectory = createdWorkspace.directory

        await executeCommand(['git', '-C', workspaceDirectory, 'checkout', '-B', runBranch, baseRef], { env })

        if (!existsSync(workspaceDirectory)) {
          throw new NotFoundError(`OpenCode workspace directory was not created at: ${workspaceDirectory}`)
        }

        return {
          directory: workspaceDirectory,
          worktreePath: workspaceDirectory,
          runBranch,
          workspaceId: createdWorkspace.id,
        }
      } catch (apiError) {
        logger.warn(`OpenCode workspace API failed, falling back to raw git worktree: ${apiError}`)
        if (createdWorkspace) {
          this.openCodeClient.forward({
            method: 'DELETE',
            path: `/experimental/workspace/${encodeURIComponent(createdWorkspace.id)}`,
            directory: repo.fullPath,
          }).catch(swallow)
        }
      }

      const worktreePath = path.join(getScheduleWorktreesPath(), `job-${job.id}-run-${runId}`)
      mkdirSyncSafe(path.dirname(worktreePath))
      await createWorktreeSafely(repo.fullPath, worktreePath, runBranch, env, baseRef)

      if (!existsSync(worktreePath)) {
        throw new NotFoundError(`Worktree directory was not created at: ${worktreePath}`)
      }

      return { directory: worktreePath, worktreePath, runBranch, workspaceId: null }
    } finally {
      if (sshSetup) {
        await this.gitAuthService.cleanupSSHKey()
      }
    }
  }

  async finalize(
    repo: Repo,
    job: { id: number; name: string; prompt: string },
    run: { id: number; worktreePath: string | null; runBranch: string | null; triggerSource: string; workspaceId?: string | null },
  ): Promise<{ commitHash: string | null }> {
    if (!run.worktreePath) {
      return { commitHash: null }
    }

    let sshSetup = false
    let env: Record<string, string> | undefined
    let commitHash: string | null = null

    try {
      if (repo.repoUrl && isSSHUrl(repo.repoUrl)) {
        await this.gitAuthService.setupSSHForRepoUrl(repo.repoUrl, this.db)
        sshSetup = true
      }

      env = await this.buildGitEnv(repo, sshSetup, false)

      const status = await executeCommand(['git', '-C', run.worktreePath, 'status', '--porcelain'], { env }).catch(() => '')

      if (status.trim()) {
        await executeCommand(['git', '-C', run.worktreePath, 'add', '-A'], { env })

        const title = `Scheduled run: ${job.name} (run #${run.id})`
        const promptSummary = job.prompt.length > 200 ? `${job.prompt.slice(0, 200)}...` : job.prompt
        const body = `Trigger: ${run.triggerSource}\nPrompt: ${promptSummary}`
        await executeCommand(['git', '-C', run.worktreePath, 'commit', '-m', title, '-m', body], { env })

        commitHash = (await executeCommand(['git', '-C', run.worktreePath, 'rev-parse', 'HEAD'], { env })).trim()
      }

      await executeCommand(['git', '-C', run.worktreePath, 'checkout', '--detach'], { env }).catch(swallow)

      return { commitHash }
    } catch (error) {
      logger.error(`Failed to finalize schedule run ${run.id} in worktree ${run.worktreePath}:`, error)
      throw error
    } finally {
      try {
        await this.deleteWorkspaceOrFallback(repo, run, env)
      } catch (error) {
        logger.error(`Failed to remove worktree ${run.worktreePath}:`, error)
        await removeWorktree(repo.fullPath, run.worktreePath, env).catch(swallow)
      }

      if (run.runBranch) {
        try {
          if (!commitHash) {
            await executeCommand(['git', '-C', repo.fullPath, 'branch', '-D', run.runBranch], env ? { env } : undefined).catch(swallow)
          } else if (run.workspaceId) {
            try {
              await executeCommand(['git', '-C', repo.fullPath, 'rev-parse', '--verify', `refs/heads/${run.runBranch}`], { env, silent: true })
            } catch {
              await executeCommand(['git', '-C', repo.fullPath, 'branch', run.runBranch, commitHash], { env })
            }
          }
        } catch {
        void 0
        }
      }

      if (sshSetup) {
        await this.gitAuthService.cleanupSSHKey()
      }
    }
  }

  async pruneRunArtifacts(
    repo: Repo,
    artifacts: { runBranch: string | null; worktreePath: string | null; workspaceId?: string | null }[],
  ): Promise<void> {
    if (artifacts.length === 0) return

    const env = await this.buildGitEnv(repo, false, true)

    await Promise.all(
      artifacts.map(async (artifact) => {
        try {
          await this.deleteWorkspaceOrFallback(repo, artifact, env)
        } catch {
          if (artifact.worktreePath) {
            await removeWorktree(repo.fullPath, artifact.worktreePath, env).catch(swallow)
          }
        }
      }),
    )

    const branches = artifacts.map((a) => a.runBranch).filter((b): b is string => b !== null && b.length > 0)
    if (branches.length > 0) {
      await executeCommand(['git', '-C', repo.fullPath, 'branch', '-D', ...branches], { env }).catch(swallow)
    }
  }

  private async deleteWorkspaceOrFallback(
    repo: Repo,
    artifact: { workspaceId?: string | null; worktreePath: string | null },
    env: Record<string, string> | undefined,
  ): Promise<void> {
    if (artifact.workspaceId) {
      const response = await this.openCodeClient.forward({
        method: 'DELETE',
        path: `/experimental/workspace/${encodeURIComponent(artifact.workspaceId)}`,
        directory: repo.fullPath,
      })
      if (!response.ok) {
        logger.warn(`OpenCode workspace DELETE returned ${response.status}, falling back to raw removeWorktree`)
        if (artifact.worktreePath) {
          await removeWorktree(repo.fullPath, artifact.worktreePath, env)
        }
      }
    } else if (artifact.worktreePath) {
      await removeWorktree(repo.fullPath, artifact.worktreePath, env)
    }
  }

  private async resolveBaseRef(repoPath: string, base: string, env: Record<string, string>): Promise<string | null> {
    for (const candidate of [`refs/remotes/origin/${base}`, `refs/heads/${base}`]) {
      try {
        await executeCommand(['git', '-C', repoPath, 'rev-parse', '--verify', candidate], { env, silent: true })
        return candidate.startsWith('refs/remotes/') ? `origin/${base}` : base
      } catch {
        continue
      }
    }
    return null
  }

  private async buildGitEnv(repo: Repo, sshSetup: boolean, silent: boolean): Promise<Record<string, string>> {
    const baseEnv = this.gitAuthService.getGitEnvironment(silent)
    const sshEnv = sshSetup ? this.gitAuthService.getSSHEnvironment() : {}
    const identityEnv = await this.buildIdentityEnv()
    return { ...baseEnv, ...buildRepoEnvForRepo(repo), ...sshEnv, ...identityEnv }
  }

  private async buildIdentityEnv(): Promise<Record<string, string>> {
    const settings = this.settingsService.getSettings()
    const gitCredentials = this.credentialProvider.getGitCredentials()
    const identity = await resolveGitIdentity(settings.preferences.gitIdentity, gitCredentials)
    return identity ? createGitIdentityEnv(identity) : {}
  }
}
