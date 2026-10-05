import fs from 'fs/promises'
import { getRepoByLocalPath, getRepoBySourcePath, ownedBy } from '../../db/queries'
import type { Database } from 'bun:sqlite'
import { reposBase } from '../repo-paths'
import { sanitizeRepoDirectoryName } from '@opencode-manager/shared/utils'
import path from 'path'
import { RepositoryAlreadyExistsError } from '../../utils/errors'
import { mkdirSafe } from '../../utils/fs-safe'
import { pathExists } from './paths'

function buildWorkspaceAliasCandidates(sourcePath: string, rootPath?: string): string[] {
  const candidates: string[] = []
  const baseName = sanitizeRepoDirectoryName(path.basename(sourcePath))
  candidates.push(baseName)

  if (rootPath) {
    const relativePath = path.relative(rootPath, sourcePath)
    if (relativePath && !relativePath.startsWith('..')) {
      const relativeAlias = relativePath
        .split(path.sep)
        .map(sanitizeRepoDirectoryName)
        .filter(Boolean)
        .join('--')

      if (relativeAlias && !candidates.includes(relativeAlias)) {
        candidates.push(relativeAlias)
      }
    }
  }

  return candidates
}

export function getWorkspaceLocalPathForRepo(sourcePath: string): string | null {
  const reposPath = path.resolve(reposBase())
  const normalizedSourcePath = path.resolve(sourcePath)

  if (normalizedSourcePath === reposPath) {
    return null
  }

  if (!normalizedSourcePath.startsWith(`${reposPath}${path.sep}`)) {
    return null
  }

  return path.relative(reposPath, normalizedSourcePath)
}

async function isWorkspaceAliasAvailable(alias: string, sourcePath?: string): Promise<boolean> {
  const aliasPath = path.join(reposBase(), alias)

  try {
    const stats = await fs.lstat(aliasPath)
    if (!sourcePath || !stats.isSymbolicLink()) {
      return false
    }

    const existingTarget = await fs.readlink(aliasPath)
    return path.resolve(path.dirname(aliasPath), existingTarget) === sourcePath
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return true
    }
    throw error
  }
}

export async function createWorkspaceLink(alias: string, sourcePath: string): Promise<void> {
  const aliasPath = path.join(reposBase(), alias)
  const available = await isWorkspaceAliasAvailable(alias, sourcePath)

  if (!available) {
    throw new RepositoryAlreadyExistsError(alias)
  }

  if (await pathExists(aliasPath)) {
    return
  }

  await mkdirSafe(path.dirname(aliasPath))
  await fs.symlink(sourcePath, aliasPath, process.platform === 'win32' ? 'junction' : 'dir')
}

/**
 * Picks a free directory name for a user's next checkout.
 *
 * `userId` is required rather than optional: this is a *name allocator*, and
 * the names it hands out have to be free within the user's own directory.
 * Left unscoped it would also stop one user from taking a name another
 * user already has in a completely separate directory - which is not a
 * conflict, just a collision between two unrelated filesystems.
 */
export async function pickWorkspaceAlias(
  database: Database,
  sourcePath: string,
  rootPath: string | undefined,
  userId: string | null,
): Promise<string> {
  const scope = ownedBy(userId)
  const existingRepo = getRepoBySourcePath(database, sourcePath, scope)
  if (existingRepo) {
    return existingRepo.localPath
  }

  const candidates = buildWorkspaceAliasCandidates(sourcePath, rootPath)
  for (const candidate of candidates) {
    const existingByLocalPath = getRepoByLocalPath(database, candidate, scope)
    if (!existingByLocalPath && await isWorkspaceAliasAvailable(candidate, sourcePath)) {
      return candidate
    }
  }

  const baseCandidate = candidates[0] || 'repo'
  let suffix = 2
  while (true) {
    const candidate = `${baseCandidate}-${suffix}`
    const existingByLocalPath = getRepoByLocalPath(database, candidate, scope)
    if (!existingByLocalPath && await isWorkspaceAliasAvailable(candidate, sourcePath)) {
      return candidate
    }
    suffix += 1
  }
}
