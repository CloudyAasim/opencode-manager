import { existsSync, rmSync } from 'node:fs'
import { executeCommand } from '../../utils/process'
import { ensureDirectoryExists } from '../file-operations'
import { createRepo, getRepoByLocalPath, updateRepoStatus, deleteRepo, getRepoByUrlAndBranch, ownedBy } from '../../db/queries'
import type { Database } from 'bun:sqlite'
import type { Repo, CreateRepoInput } from '../../types/repo'
import { logger } from '../../utils/logger'
import { reposBase } from '../repo-paths'
import { normalizeRepoDirectoryName, sanitizeRepoDirectoryName, sanitizeBranchForDirectory, normalizeRepoUrlForCompare, isSSHUrl, normalizeSSHUrl, SCP_STYLE_URL_PATTERN } from '@opencode-manager/shared/utils'
import type { GitAuthService } from '../git-auth'
import { isGitHubHttpsUrl } from '../../utils/git-auth'
import path from 'path'
import { parseSSHHost } from '../../utils/ssh-key-manager'
import { getErrorMessage } from '../../utils/error-utils'
import { ConflictError, NotFoundError, ServiceUnavailableError, ValidationError } from '../../utils/errors'
import { normalizeInputPath, resolveRepoPathInsideBase } from './paths'
import { createWorktreeSafely } from './worktree'
import { registerExistingLocalRepo } from './discovery'

const GIT_CLONE_TIMEOUT = 300000

/**
 * Strips `user:password@` from a URL for storage, logging and error messages.
 *
 * Cloning a private repository with the token in the URL is ordinary practice,
 * and `normalizeRepoUrl` passes such URLs through untouched - so without this
 * the token ends up in the `repos` table, in the logs, in every clone error
 * message and in the repo listings returned to the owner and to admins.
 *
 * The credential is deliberately *not* removed from the URL handed to `git`:
 * the askpass handler supplies stored credentials, but a user who put the token
 * in the URL is relying on it, and stripping it there would break them.
 */
export function redactRepoUrlCredentials(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1')
}

/**
 * Removes credentials from a freshly cloned repository's `origin`.
 *
 * `git clone` records the URL it was given verbatim, so a clone made with
 * `https://user:token@host/...` leaves the token in `.git/config` on disk -
 * outside the database and outside anything the redaction above covers.
 *
 * Only done when the account has a stored credential for the host: the askpass
 * handler resolves those by host, so fetch and push keep working against the
 * clean URL. Without one the embedded credential is the only credential there
 * is, and rewriting it would silently break every later operation on the
 * repository. In that case the URL is left alone and the fact is logged.
 */
async function scrubCredentialsFromRemote(
  gitAuthService: GitAuthService,
  repoPath: string,
  clonedUrl: string,
  cleanUrl: string,
  userId: string | null,
  env: Record<string, string>,
): Promise<void> {
  if (clonedUrl === cleanUrl) return

  let host: string
  try {
    host = new URL(clonedUrl).host
  } catch {
    return
  }

  if (!gitAuthService.hasStoredPatForHost(host, userId)) {
    logger.warn(
      `Left the embedded credential in ${cleanUrl}'s git remote: this account has no stored credential for ${host}. ` +
      'Removing it would break fetch and push.',
    )
    return
  }

  await executeCommand(['git', '-C', repoPath, 'remote', 'set-url', 'origin', cleanUrl], { cwd: repoPath, env })
  logger.info(`Rewrote the git remote for ${cleanUrl} to its credential-free form`)
}

function enhanceCloneError(error: unknown, repoUrl: string, originalMessage: string): Error {
  // Redact here rather than at each call site: every branch below interpolates
  // the URL into a message that is both logged and returned to the client.
  const safeUrl = redactRepoUrlCredentials(repoUrl)
  const message = originalMessage.toLowerCase()
  
  if (message.includes('authentication failed') || message.includes('could not authenticate') || message.includes('invalid credentials')) {
    return new Error(`Authentication failed for ${safeUrl}. Please add your credentials in Settings > Git Credentials.`)
  }
  
  if (message.includes('repository not found') || message.includes('404')) {
    return new Error(`Repository not found: ${safeUrl}. Check the URL and ensure you have access to it.`)
  }
  
  if (isSSHUrl(repoUrl) && message.includes('permission denied')) {
    return new Error(`Access denied to ${safeUrl}. Please add your SSH credentials in Settings > Git Credentials and ensure your SSH key has access to this repository.`)
  }
  
  if (isGitHubHttpsUrl(repoUrl) && (message.includes('permission denied') || message.includes('fatal'))) {
    return new Error(`Access denied to ${safeUrl}. Please add your credentials in Settings > Git Credentials and ensure you have proper access.`)
  }
  
  if (message.includes('timed out')) {
    return new Error(`Clone timed out for ${safeUrl}. The repository might be too large or there could be network issues. Try again or verify the repository exists.`)
  }
  
  return error instanceof Error ? error : new Error(originalMessage)
}



export async function initLocalRepo(
  database: Database,
  gitAuthService: GitAuthService,
  localPath: string,
  branch?: string,
  userId?: string | null
): Promise<Repo> {
  const normalizedInputPath = normalizeInputPath(localPath)

  if (path.isAbsolute(normalizedInputPath)) {
    const result = await registerExistingLocalRepo(database, gitAuthService, normalizedInputPath, branch, undefined, userId)
    return result.repo
  }

  const repoLocalPath = normalizedInputPath
  // This value becomes the `local_path` column, which the delete path hands to
  // `rm -rf`, and the rollback below removes it too. Nothing else stands
  // between it and the filesystem, so the escape check happens here - at the
  // only place it can still be cheap.
  const targetPath = resolveRepoPathInsideBase(repoLocalPath, reposBase())
  const existing = getRepoByLocalPath(database, repoLocalPath, ownedBy(userId))
  if (existing) {
    logger.info(`Local repo already exists in database: ${repoLocalPath}`)
    return existing
  }
  
  const createRepoInput: CreateRepoInput = {
    localPath: repoLocalPath,
    sourcePath: targetPath,
    branch: branch || undefined,
    defaultBranch: branch || 'main',
    cloneStatus: 'cloning',
    clonedAt: Date.now(),
    isLocal: true,
    userId: userId ?? null,
  }
  
  let repo: Repo
  let directoryCreated = false
  
  try {
    repo = createRepo(database, createRepoInput)
    logger.info(`Created database record for local repo: ${repoLocalPath} (id: ${repo.id})`)
  } catch (error: unknown) {
    logger.error(`Failed to create database record for local repo: ${repoLocalPath}`, error)
    throw new Error(`Failed to register local repository '${repoLocalPath}': ${getErrorMessage(error)}`)
  }
  
  try {
    await ensureDirectoryExists(targetPath)
    directoryCreated = true
    logger.info(`Created directory for local repo: ${targetPath}`)

    logger.info(`Initializing git repository: ${targetPath}`)
    await executeCommand(['git', 'init'], { cwd: targetPath })

    if (branch && branch !== 'main') {
      await executeCommand(['git', '-C', targetPath, 'checkout', '-b', branch])
    }
    
    const isGitRepo = await executeCommand(['git', '-C', targetPath, 'rev-parse', '--git-dir'])
      .then(() => true)
      .catch(() => false)
    
    if (!isGitRepo) {
      throw new ValidationError(`Git initialization failed - directory exists but is not a valid git repository`)
    }
    
    updateRepoStatus(database, repo.id, 'ready')
    logger.info(`Local git repo ready: ${repoLocalPath}`)
    return { ...repo, cloneStatus: 'ready' }
  } catch (error: unknown) {
    logger.error(`Failed to initialize local repo, rolling back: ${repoLocalPath}`, error)
    
    try {
      deleteRepo(database, repo.id)
      logger.info(`Rolled back database record for repo id: ${repo.id}`)
    } catch (dbError: unknown) {
      logger.error(`Failed to rollback database record for repo id ${repo.id}:`, getErrorMessage(dbError))
    }
    
    if (directoryCreated) {
      try {
        await executeCommand(['rm', '-rf', targetPath])
        logger.info(`Rolled back directory: ${targetPath}`)
      } catch (fsError: unknown) {
        logger.error(`Failed to rollback directory ${repoLocalPath}:`, getErrorMessage(fsError))
      }
    }
    
    throw new Error(`Failed to initialize local repository '${repoLocalPath}': ${getErrorMessage(error)}`)
  }
}

export interface CloneRepoOptions {
  branch?: string
  directoryName?: string
  useWorktree?: boolean
  skipSSHVerification?: boolean
  baseBranch?: string
  userId?: string | null
}

export async function cloneRepo(
  database: Database,
  gitAuthService: GitAuthService,
  repoUrl: string,
  options: CloneRepoOptions = {}
): Promise<Repo> {
  const { branch, directoryName, useWorktree = false, skipSSHVerification = false, baseBranch, userId = null } = options
  const effectiveUrl = normalizeSSHUrl(repoUrl)
  const isSSH = isSSHUrl(effectiveUrl)
  const preserveSSH = isSSH
  const { url: normalizedRepoUrl, name: repoName } = normalizeRepoUrl(effectiveUrl, preserveSSH)
  // What we persist and display. `normalizedRepoUrl` stays as-is for every
  // `git` invocation, because a user who put the token in the URL is relying on
  // it being passed through.
  const storedRepoUrl = redactRepoUrlCredentials(normalizedRepoUrl)
  const dirName = directoryName === undefined
    ? sanitizeRepoDirectoryName(repoName)
    : normalizeRepoDirectoryName(directoryName)
  const baseRepoDirName = dirName
  const worktreeDirName = branch && useWorktree ? `${dirName}-${sanitizeBranchForDirectory(branch)}` : dirName
  const localPath = worktreeDirName

  // Owned, not global: two users cloning the same URL is two repositories, and
  // returning the first user's row here is what turned that into a 403.
  //
  // Both spellings are looked up. Rows created before the redaction store the
  // credential-bearing URL, and new rows store the clean one - so keying on
  // only one of them would make a re-clone of an already-cloned repository
  // silently create a duplicate.
  const existing =
    getRepoByUrlAndBranch(database, normalizedRepoUrl, branch, ownedBy(userId)) ??
    getRepoByUrlAndBranch(database, storedRepoUrl, branch, ownedBy(userId))

  if (existing) {
    logger.info(`Repo branch already exists: ${redactRepoUrlCredentials(normalizedRepoUrl)}${branch ? `#${branch}` : ''}`)
    return existing
  }

  await ensureDirectoryExists(reposBase())
  const baseRepoExists = existsSync(path.join(path.resolve(reposBase()), baseRepoDirName))

  const shouldUseWorktree = useWorktree && branch && baseRepoExists

  const createRepoInput: CreateRepoInput = {
    repoUrl: storedRepoUrl,
    localPath,
    sourcePath: path.resolve(reposBase(), localPath),
    branch: branch || undefined,
    defaultBranch: branch || 'main',
    cloneStatus: 'cloning',
    clonedAt: Date.now(),
    userId,
  }
  
  if (shouldUseWorktree) {
    createRepoInput.isWorktree = true
  }
  
  const repo = createRepo(database, createRepoInput)

  try {
    await gitAuthService.setupSSHForRepoUrl(effectiveUrl, database, skipSSHVerification, userId)

    const env = {
      ...gitAuthService.getGitEnvironment(),
      ...(isSSH ? gitAuthService.getSSHEnvironment() : {})
    }

    if (shouldUseWorktree) {
      logger.info(`Creating worktree for branch: ${branch}`)
      
      const baseRepoPath = path.resolve(reposBase(), baseRepoDirName)
      const worktreePath = path.resolve(reposBase(), worktreeDirName)
      
       await executeCommand(['git', '-C', baseRepoPath, 'fetch', '--all'], { cwd: reposBase(), env })

      
       await createWorktreeSafely(baseRepoPath, worktreePath, branch, env, baseBranch)
      
      const worktreeVerified = existsSync(worktreePath)
      
      if (!worktreeVerified) {
        throw new NotFoundError(`Worktree directory was not created at: ${worktreePath}`)
      }
      
      logger.info(`Worktree verified at: ${worktreePath}`)
      
    } else if (branch && baseRepoExists && useWorktree) {
      logger.info(`Base repo exists but worktree creation failed, cloning branch separately`)
      
      const worktreeExists = existsSync(path.join(path.resolve(reposBase()), worktreeDirName))
      if (worktreeExists) {
        logger.info(`Workspace directory exists, removing it: ${worktreeDirName}`)
        try {
          rmSync(path.join(path.resolve(reposBase()), worktreeDirName), { recursive: true, force: true })
          const verifyRemoved = !existsSync(path.join(path.resolve(reposBase()), worktreeDirName))
          if (!verifyRemoved) {
            throw new ServiceUnavailableError(`Failed to remove existing directory: ${worktreeDirName}`)
          }
        } catch (cleanupError: unknown) {
          logger.error(`Failed to clean up existing directory: ${worktreeDirName}`, cleanupError)
          throw new ConflictError(`Cannot clone: directory ${worktreeDirName} exists and could not be removed`)
        }
      }
      
      try {
        await executeCommand(['git', 'clone', '-b', branch, normalizedRepoUrl, worktreeDirName], { cwd: reposBase(), env, timeout: GIT_CLONE_TIMEOUT })
      } catch (error: unknown) {
        if (getErrorMessage(error).includes('destination path') && getErrorMessage(error).includes('already exists')) {
          logger.error(`Clone failed: directory still exists after cleanup attempt`)
          throw new ConflictError(`Workspace directory ${worktreeDirName} already exists. Please delete it manually or contact support.`)
        }
        
        if (branch && (getErrorMessage(error).includes('Remote branch') || getErrorMessage(error).includes('not found'))) {
          logger.info(`Branch '${branch}' not found, cloning default branch and creating branch locally`)
          try {
            await executeCommand(['git', 'clone', normalizedRepoUrl, worktreeDirName], { cwd: reposBase(), env, timeout: GIT_CLONE_TIMEOUT })
          } catch (cloneError: unknown) {
            throw enhanceCloneError(cloneError, normalizedRepoUrl, getErrorMessage(cloneError))
          }
          
          let localBranchExists = 'missing'
          try {
            await executeCommand(['git', '-C', path.resolve(reposBase(), worktreeDirName), 'rev-parse', '--verify', `refs/heads/${branch}`])
            localBranchExists = 'exists'
          } catch {
            localBranchExists = 'missing'
          }
          
          if (localBranchExists.trim() === 'missing') {
            await executeCommand(['git', '-C', path.resolve(reposBase(), worktreeDirName), 'checkout', '-b', branch])
          } else {
            await executeCommand(['git', '-C', path.resolve(reposBase(), worktreeDirName), 'checkout', branch])
          }
        } else {
          throw enhanceCloneError(error, normalizedRepoUrl, getErrorMessage(error))
        }
      }
    } else {
      if (baseRepoExists) {
        logger.info(`Repository directory already exists, verifying it's a valid git repo: ${baseRepoDirName}`)
        const isValidRepo = await executeCommand(['git', '-C', path.resolve(reposBase(), baseRepoDirName), 'rev-parse', '--git-dir'], path.resolve(reposBase())).then(() => 'valid').catch(() => 'invalid')
        
        if (isValidRepo.trim() === 'valid') {
          const existingOriginUrl = await executeCommand(
            ['git', '-C', path.resolve(reposBase(), baseRepoDirName), 'remote', 'get-url', 'origin'],
            { cwd: path.resolve(reposBase()), silent: true }
          ).then((output) => output.trim()).catch(() => '')

          if (existingOriginUrl && normalizeRepoUrlForCompare(existingOriginUrl) !== normalizeRepoUrlForCompare(normalizedRepoUrl)) {
            // `git remote get-url` hands back whatever was cloned, credentials
            // and all, so this message has to be redacted too - it is returned
            // to the client and logged by the outer handler.
            const collisionError = new Error(`Directory '${baseRepoDirName}' already contains a different repository (${redactRepoUrlCredentials(existingOriginUrl)}). Choose a different directory name.`) as Error & { statusCode: number }
            collisionError.statusCode = 409
            throw collisionError
          }

          logger.info(`Valid repository found: ${storedRepoUrl}`)
          
          if (branch) {
            logger.info(`Switching to branch: ${branch}`)
             await executeCommand(['git', '-C', path.resolve(reposBase(), baseRepoDirName), 'fetch', '--all'], { cwd: reposBase(), env })

            
            let remoteBranchExists = false
            try {
              await executeCommand(['git', '-C', path.resolve(reposBase(), baseRepoDirName), 'rev-parse', '--verify', `refs/remotes/origin/${branch}`])
              remoteBranchExists = true
            } catch {
              remoteBranchExists = false
            }
            
            let localBranchExists = false
            try {
              await executeCommand(['git', '-C', path.resolve(reposBase(), baseRepoDirName), 'rev-parse', '--verify', `refs/heads/${branch}`])
              localBranchExists = true
            } catch {
              localBranchExists = false
            }
            
            if (localBranchExists) {
              logger.info(`Checking out existing local branch: ${branch}`)
              await executeCommand(['git', '-C', path.resolve(reposBase(), baseRepoDirName), 'checkout', branch])
            } else if (remoteBranchExists) {
              logger.info(`Checking out remote branch: ${branch}`)
              await executeCommand(['git', '-C', path.resolve(reposBase(), baseRepoDirName), 'checkout', '-b', branch, `origin/${branch}`])
            } else {
              logger.info(`Creating new branch: ${branch}`)
              await executeCommand(['git', '-C', path.resolve(reposBase(), baseRepoDirName), 'checkout', '-b', branch])
            }
          }
          
          updateRepoStatus(database, repo.id, 'ready')
          return { ...repo, cloneStatus: 'ready' }
        } else {
          logger.warn(`Invalid repository directory found, removing and recloning: ${baseRepoDirName}`)
          rmSync(path.join(reposBase(), baseRepoDirName), { recursive: true, force: true })
        }
      }
      
      logger.info(`Cloning repo: ${storedRepoUrl}${branch ? ` to branch ${branch}` : ''}`)
      
      const worktreeExists = existsSync(path.join(reposBase(), worktreeDirName))
      if (worktreeExists) {
        logger.info(`Workspace directory exists, removing it: ${worktreeDirName}`)
        try {
          rmSync(path.join(reposBase(), worktreeDirName), { recursive: true, force: true })
          const verifyRemoved = !existsSync(path.join(reposBase(), worktreeDirName))
          if (!verifyRemoved) {
            throw new ServiceUnavailableError(`Failed to remove existing directory: ${worktreeDirName}`)
          }
        } catch (cleanupError: unknown) {
          logger.error(`Failed to clean up existing directory: ${worktreeDirName}`, cleanupError)
          throw new ConflictError(`Cannot clone: directory ${worktreeDirName} exists and could not be removed`)
        }
      }
    
      try {
        const cloneCmd = branch
          ? ['git', 'clone', '-b', branch, normalizedRepoUrl, worktreeDirName]
          : ['git', 'clone', normalizedRepoUrl, worktreeDirName]
        
        await executeCommand(cloneCmd, { cwd: reposBase(), env, timeout: GIT_CLONE_TIMEOUT })
      } catch (error: unknown) {
        if (getErrorMessage(error).includes('destination path') && getErrorMessage(error).includes('already exists')) {
          logger.error(`Clone failed: directory still exists after cleanup attempt`)
          throw new ConflictError(`Workspace directory ${worktreeDirName} already exists. Please delete it manually or contact support.`)
        }
        
        if (branch && (getErrorMessage(error).includes('Remote branch') || getErrorMessage(error).includes('not found'))) {
          logger.info(`Branch '${branch}' not found, cloning default branch and creating branch locally`)
          try {
            await executeCommand(['git', 'clone', normalizedRepoUrl, worktreeDirName], { cwd: reposBase(), env, timeout: GIT_CLONE_TIMEOUT })
          } catch (cloneError: unknown) {
            throw enhanceCloneError(cloneError, normalizedRepoUrl, getErrorMessage(cloneError))
          }
          
          let localBranchExists = 'missing'
          try {
            await executeCommand(['git', '-C', path.resolve(reposBase(), worktreeDirName), 'rev-parse', '--verify', `refs/heads/${branch}`])
            localBranchExists = 'exists'
          } catch {
            localBranchExists = 'missing'
          }
          
          if (localBranchExists.trim() === 'missing') {
            await executeCommand(['git', '-C', path.resolve(reposBase(), worktreeDirName), 'checkout', '-b', branch])
          } else {
            await executeCommand(['git', '-C', path.resolve(reposBase(), worktreeDirName), 'checkout', branch])
          }
        } else {
          throw enhanceCloneError(error, normalizedRepoUrl, getErrorMessage(error))
        }
      }
    }

    // Only the clone branches put a URL into a `.git/config`; the worktree
    // branch creates a worktree from a repository that was cloned earlier.
    if (!shouldUseWorktree) {
      await scrubCredentialsFromRemote(
        gitAuthService,
        path.resolve(reposBase(), worktreeDirName),
        normalizedRepoUrl,
        storedRepoUrl,
        userId,
        env,
      )
    }

    updateRepoStatus(database, repo.id, 'ready')
    logger.info(`Repo ready: ${storedRepoUrl}${branch ? `#${branch}` : ''}${shouldUseWorktree ? ' (worktree)' : ''}`)
    return { ...repo, cloneStatus: 'ready' }
  } catch (error: unknown) {
    logger.error(`Failed to create repo: ${storedRepoUrl}${branch ? `#${branch}` : ''}`, error)
    deleteRepo(database, repo.id)
    throw error
  } finally {
    await gitAuthService.cleanupSSHKey()
  }
}

export function normalizeRepoUrl(url: string, preserveSSH: boolean = false): { url: string; name: string } {
  const sshMatch = url.match(SCP_STYLE_URL_PATTERN)
  if (sshMatch) {
    const [, , host, pathPart] = sshMatch
    const path = (pathPart ?? '').replace(/\.git$/, '')
    const repoName = path.split('/').pop() || `repo-${Date.now()}`
    return {
      url: preserveSSH ? url : `https://${host}/${path}`,
      name: repoName
    }
  }

  if (url.startsWith('ssh://')) {
    const { host } = parseSSHHost(url)
    const pathParts = url.split(`${host}/`)
    const pathPart = pathParts[1] || ''
    const repoName = pathPart.replace(/\.git$/, '').split('/').pop() || `repo-${Date.now()}`
    
    return {
      url: preserveSSH ? url : `https://${host}/${pathPart.replace(/\.git$/, '')}`,
      name: repoName
    }
  }

  const shorthandMatch = url.match(/^([^/]+)\/([^/]+)$/)
  if (shorthandMatch) {
    const [, owner, repoName] = shorthandMatch
    return {
      url: `https://github.com/${owner}/${repoName}`,
      name: repoName ?? `repo-${Date.now()}`
    }
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    const httpsUrl = url.replace(/^http:/, 'https:').replace(/\.git$/, '')
    const match = httpsUrl.match(/([^/]+)$/)
    return {
      url: httpsUrl,
      name: match?.[1] || `repo-${Date.now()}`
    }
  }

  return {
    url,
    name: `repo-${Date.now()}`
  }
}
