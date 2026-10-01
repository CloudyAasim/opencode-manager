import fs from 'fs/promises'
import { createRepo, getRepoByLocalPath, getRepoBySourcePath } from '../../db/queries'
import type { Database } from 'bun:sqlite'
import type { Repo } from '../../types/repo'
import { logger } from '../../utils/logger'
import type { GitAuthService } from '../git-auth'
import path from 'path'
import { getErrorMessage } from '../../utils/error-utils'
import { NotFoundError, ValidationError } from '../../utils/errors'
import {
  findGitRepoRoot,
  isGitRepoRootPath,
  isGitWorktreeRepo,
  isValidGitRepo,
  normalizeAbsolutePath,
  normalizeInputPath,
  pathExists,
} from './paths'
import {
  createWorkspaceLink,
  getWorkspaceLocalPathForRepo,
  pickWorkspaceAlias,
} from './workspace-alias'
import { checkoutBranchSafely, safeGetCurrentBranch } from './branch'

const DEFAULT_DISCOVERY_MAX_DEPTH = 4

const DISCOVERY_SKIP_DIRECTORIES = new Set(['.git', 'node_modules'])

export async function registerExistingLocalRepo(
  database: Database,
  gitAuthService: GitAuthService,
  sourcePath: string,
  branch?: string,
  rootPath?: string,
  userId?: string | null
): Promise<{ repo: Repo; existed: boolean }> {
  const normalizedSourcePath = normalizeAbsolutePath(sourcePath)
  const env = gitAuthService.getGitEnvironment()
  const existingBySourcePath = getRepoBySourcePath(database, normalizedSourcePath)

  if (existingBySourcePath) {
    logger.info(`Local repo already exists in database: ${normalizedSourcePath}`)
    return { repo: existingBySourcePath, existed: true }
  }

  const exists = await pathExists(normalizedSourcePath)
  if (!exists) {
    throw new NotFoundError(`No such file or directory: '${normalizedSourcePath}'`)
  }

  const isGitRepo = await isValidGitRepo(normalizedSourcePath, env)
  if (!isGitRepo) {
    throw new ValidationError(`Directory exists but is not a valid Git repository. Use folder discovery to scan nested repositories.`)
  }

  if (branch) {
    const currentBranch = await safeGetCurrentBranch(normalizedSourcePath, env)
    if (currentBranch !== branch) {
      await checkoutBranchSafely(normalizedSourcePath, branch, env)
    }
  }

  const currentBranch = await safeGetCurrentBranch(normalizedSourcePath, env)
  const workspaceLocalPath = getWorkspaceLocalPathForRepo(normalizedSourcePath)

  if (workspaceLocalPath) {
    const existingByLocalPath = getRepoByLocalPath(database, workspaceLocalPath)
    if (existingByLocalPath) {
      logger.info(`Workspace repo already exists in database: ${workspaceLocalPath}`)
      return { repo: existingByLocalPath, existed: true }
    }
  }

  const repoLocalPath = workspaceLocalPath || await pickWorkspaceAlias(database, normalizedSourcePath, rootPath)
  if (!workspaceLocalPath) {
    await createWorkspaceLink(repoLocalPath, normalizedSourcePath)
  }

  const repo = createRepo(database, {
    localPath: repoLocalPath,
    sourcePath: normalizedSourcePath,
    branch: branch || currentBranch || undefined,
    defaultBranch: branch || currentBranch || 'main',
    cloneStatus: 'ready',
    clonedAt: Date.now(),
    isLocal: true,
    isWorktree: await isGitWorktreeRepo(normalizedSourcePath),
    userId: userId ?? null,
  })

  logger.info(`Registered local repo at ${normalizedSourcePath} as ${repoLocalPath}`)
  return { repo, existed: false }
}

export async function discoverLocalRepos(
  database: Database,
  gitAuthService: GitAuthService,
  rootPath: string,
  maxDepth: number = DEFAULT_DISCOVERY_MAX_DEPTH,
  userId?: string | null
): Promise<{
  repos: Repo[]
  discoveredCount: number
  existingCount: number
  errors: Array<{ path: string; error: string }>
}> {
  const normalizedRootPath = normalizeAbsolutePath(rootPath)
  const rootStats = await fs.stat(normalizedRootPath).catch((error: unknown) => {
    throw new Error(`Failed to access '${normalizedRootPath}': ${getErrorMessage(error)}`)
  })

  if (!rootStats.isDirectory()) {
    throw new ValidationError(`Path is not a directory: '${normalizedRootPath}'`)
  }

  const repoPaths: string[] = []
  const errors: Array<{ path: string; error: string }> = []

  const walk = async (currentPath: string, depth: number): Promise<void> => {
    try {
      if (await isGitRepoRootPath(currentPath)) {
        repoPaths.push(currentPath)
        return
      }

      if (depth >= maxDepth) {
        return
      }

      const entries = await fs.readdir(currentPath, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || DISCOVERY_SKIP_DIRECTORIES.has(entry.name)) {
          continue
        }

        await walk(path.join(currentPath, entry.name), depth + 1)
      }
    } catch (error: unknown) {
      errors.push({
        path: currentPath,
        error: getErrorMessage(error),
      })
    }
  }

  await walk(normalizedRootPath, 0)

  const repos: Repo[] = []
  let discoveredCount = 0
  let existingCount = 0

  for (const repoPath of repoPaths.sort((left, right) => left.localeCompare(right))) {
    try {
      const result = await registerExistingLocalRepo(database, gitAuthService, repoPath, undefined, normalizedRootPath, userId)
      repos.push(result.repo)
      if (result.existed) {
        existingCount += 1
      } else {
        discoveredCount += 1
      }
    } catch (error: unknown) {
      errors.push({
        path: repoPath,
        error: getErrorMessage(error),
      })
    }
  }

  return {
    repos,
    discoveredCount,
    existingCount,
    errors,
  }
}

export async function relinkReposFromSessionDirectories(
  database: Database,
  gitAuthService: GitAuthService,
  directories: string[]
): Promise<{
  repos: Repo[]
  relinkedCount: number
  existingCount: number
  nonRepoPathCount: number
  duplicatePathCount: number
  errors: Array<{ path: string; error: string }>
}> {
  const env = gitAuthService.getGitEnvironment()
  const errors: Array<{ path: string; error: string }> = []
  const uniqueRepoRoots = new Set<string>()
  let nonRepoPathCount = 0
  let duplicatePathCount = 0

  for (const directory of directories) {
    const normalizedDirectory = normalizeInputPath(directory)
    if (!normalizedDirectory) {
      nonRepoPathCount += 1
      continue
    }

    const repoRoot = await findGitRepoRoot(normalizedDirectory, env)
    if (!repoRoot) {
      nonRepoPathCount += 1
      continue
    }

    if (uniqueRepoRoots.has(repoRoot)) {
      duplicatePathCount += 1
      continue
    }

    uniqueRepoRoots.add(repoRoot)
  }

  const repos: Repo[] = []
  let relinkedCount = 0
  let existingCount = 0

  for (const repoRoot of Array.from(uniqueRepoRoots).sort((left, right) => left.localeCompare(right))) {
    try {
      const result = await registerExistingLocalRepo(database, gitAuthService, repoRoot)
      repos.push(result.repo)
      if (result.existed) {
        existingCount += 1
      } else {
        relinkedCount += 1
      }
    } catch (error: unknown) {
      errors.push({
        path: repoRoot,
        error: getErrorMessage(error),
      })
    }
  }

  return {
    repos,
    relinkedCount,
    existingCount,
    nonRepoPathCount,
    duplicatePathCount,
    errors,
  }
}
