import { executeCommand } from '../../utils/process'
import { getRepoById, updateRepoBranch, updateLastPulled } from '../../db/queries'
import type { Database } from 'bun:sqlite'
import type { Repo } from '../../types/repo'
import { logger } from '../../utils/logger'
import type { GitAuthService } from '../git-auth'
import path from 'path'
import { NotFoundError } from '../../utils/errors'
import { hasCommits } from './paths'

export async function safeGetCurrentBranch(repoPath: string, env: Record<string, string>): Promise<string | null> {
  try {
    const repoHasCommits = await hasCommits(repoPath, env)
    if (!repoHasCommits) {
      try {
        const symbolicRef = await executeCommand(['git', '-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], { env, silent: true })
        return symbolicRef.trim()
      } catch {
        return null
      }
    }
    const currentBranch = await executeCommand(['git', '-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD'], { env, silent: true })
    return currentBranch.trim()
  } catch {
    return null
  }
}

export async function checkoutBranchSafely(repoPath: string, branch: string, env: Record<string, string>): Promise<void> {
  const sanitizedBranch = branch
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/remotes\//, '')
    .replace(/^origin\//, '')

  let localBranchExists = false
  try {
    await executeCommand(['git', '-C', repoPath, 'rev-parse', '--verify', `refs/heads/${sanitizedBranch}`], { env, silent: true })
    localBranchExists = true
  } catch {
    localBranchExists = false
  }

  let remoteBranchExists = false
  try {
    await executeCommand(['git', '-C', repoPath, 'rev-parse', '--verify', `refs/remotes/origin/${sanitizedBranch}`], { env, silent: true })
    remoteBranchExists = true
  } catch {
    remoteBranchExists = false
  }

  if (localBranchExists) {
    logger.info(`Checking out existing local branch: ${sanitizedBranch}`)
    await executeCommand(['git', '-C', repoPath, 'checkout', sanitizedBranch], { env })
  } else if (remoteBranchExists) {
    logger.info(`Checking out remote branch: ${sanitizedBranch}`)
    await executeCommand(['git', '-C', repoPath, 'checkout', '-b', sanitizedBranch, `origin/${sanitizedBranch}`], { env })
  } else {
    logger.info(`Creating new branch: ${sanitizedBranch}`)
    await executeCommand(['git', '-C', repoPath, 'checkout', '-b', sanitizedBranch], { env })
  }
}

export async function getCurrentBranch(repo: Repo, env: Record<string, string>): Promise<string | null> {
  const repoPath = path.resolve(repo.fullPath)
  const branch = await safeGetCurrentBranch(repoPath, env)
  return branch || repo.branch || repo.defaultBranch || null
}

export async function switchBranch(
  database: Database,
  gitAuthService: GitAuthService,
  repoId: number,
  branch: string
): Promise<void> {
  const repo = getRepoById(database, repoId)
  if (!repo) {
    throw new NotFoundError(`Repo not found: ${repoId}`)
  }
  
  try {
    const repoPath = path.resolve(repo.fullPath)
    const env = gitAuthService.getGitEnvironment()

    const sanitizedBranch = branch
      .replace(/^refs\/heads\//, '')
      .replace(/^refs\/remotes\//, '')
      .replace(/^origin\//, '')

    logger.info(`Switching to branch: ${sanitizedBranch} in ${repo.localPath}`)

    await executeCommand(['git', '-C', repoPath, 'fetch', '--all'], { env })
    
    await checkoutBranchSafely(repoPath, sanitizedBranch, env)
    
    logger.info(`Successfully switched to branch: ${sanitizedBranch}`)

    updateRepoBranch(database, repoId, sanitizedBranch)
  } catch (error: unknown) {
    logger.error(`Failed to switch branch for repo ${repoId}:`, error)
    throw error
  }
}

export async function createBranch(database: Database, gitAuthService: GitAuthService, repoId: number, branch: string): Promise<void> {
  const repo = getRepoById(database, repoId)
  if (!repo) {
    throw new NotFoundError(`Repo not found: ${repoId}`)
  }
  
  try {
    const repoPath = path.resolve(repo.fullPath)
    const env = gitAuthService.getGitEnvironment()
    
    const sanitizedBranch = branch
      .replace(/^refs\/heads\//, '')
      .replace(/^refs\/remotes\//, '')
      .replace(/^origin\//, '')

    logger.info(`Creating new branch: ${sanitizedBranch} in ${repo.localPath}`)
    await executeCommand(['git', '-C', repoPath, 'checkout', '-b', sanitizedBranch], { env })
    logger.info(`Successfully created and switched to branch: ${sanitizedBranch}`)

    updateRepoBranch(database, repoId, sanitizedBranch)
  } catch (error: unknown) {
    logger.error(`Failed to create branch for repo ${repoId}:`, error)
    throw error
  }
}

export async function pullRepo(
  database: Database,
  gitAuthService: GitAuthService,
  repoId: number
): Promise<void> {
  const repo = getRepoById(database, repoId)
  if (!repo) {
    throw new NotFoundError(`Repo not found: ${repoId}`)
  }
  
  if (repo.isLocal) {
    logger.info(`Skipping pull for local repo: ${repo.localPath}`)
    return
  }
  
  try {
    const env = gitAuthService.getGitEnvironment()

    logger.info(`Pulling repo: ${repo.repoUrl}`)
    await executeCommand(['git', '-C', path.resolve(repo.fullPath), 'pull'], { env })
    
    updateLastPulled(database, repoId)
    logger.info(`Repo pulled successfully: ${repo.repoUrl}`)
  } catch (error: unknown) {
    logger.error(`Failed to pull repo: ${repo.repoUrl}`, error)
    throw error
  }
}

export async function resolveDefaultBranch(repoPath: string, env: Record<string, string>): Promise<string> {
  return executeCommand(['git', '-C', repoPath, 'rev-parse', '--abbrev-ref', 'origin/HEAD'], { env, silent: true })
    .then((ref) => ref.trim().replace('origin/', ''))
    .catch(() => 'main')
}
