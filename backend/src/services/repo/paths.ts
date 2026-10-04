import fs from 'fs/promises'
import { executeCommand } from '../../utils/process'
import { ValidationError } from '../../utils/errors'
import path from 'path'

export function normalizeInputPath(input: string): string {
  return input.trim().replace(/[\\/]+$/, '')
}

/**
 * Resolves a stored repository path against the repositories directory and
 * refuses anything that is not plainly a path *inside* it.
 *
 * `local_path` is a SQLite column and the delete path hands it straight to
 * `rm -rf`. Trimming trailing slashes is not a containment check: `../x` and an
 * absolute path both survive it, and either one turns "delete this project"
 * into "delete that directory".
 *
 * Absolute paths are refused even when they point inside the base. Not because
 * that is where the danger is - the base check already covers that - but
 * because the column is a relative path everywhere else: worktree directory
 * naming and `getRepoBaseDirectoryName` both do string surgery on the relative
 * form. Accepting an absolute value quietly gives one column two meanings and
 * makes that arithmetic wrong, so a row carrying one is corrupt or hostile
 * either way.
 *
 * The base is passed in rather than read from the ambient access scope on
 * purpose. `assertWithinAccessScope` is the right guard for request-driven file
 * browsing, but it returns silently when no scope is set - so a check built on
 * it would be a no-op in exactly the situations (startup, background jobs,
 * tests) where it matters most, and it would go green while doing nothing.
 * This one is intrinsic to the operation and cannot be skipped.
 *
 * The base directory itself is rejected too: `rm -rf` on it would take every
 * checkout in it, not just the one being deleted.
 */
export function resolveRepoPathInsideBase(localPath: string, base: string): string {
  const resolvedBase = path.resolve(base)

  if (path.isAbsolute(localPath)) {
    throw new ValidationError(
      `Refusing to operate on '${localPath}': repository paths are stored relative to '${resolvedBase}', not as absolute paths`,
    )
  }

  const target = path.resolve(resolvedBase, localPath)
  const relative = path.relative(resolvedBase, target)

  const escapes =
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)

  if (escapes) {
    throw new ValidationError(
      `Refusing to operate on '${localPath}': it resolves to '${target}', which is outside the repositories directory '${resolvedBase}'`,
    )
  }

  return target
}

export function normalizeAbsolutePath(input: string): string {
  return path.resolve(normalizeInputPath(input))
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.lstat(targetPath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

export async function isGitRepoRootPath(targetPath: string): Promise<boolean> {
  try {
    const gitPath = path.join(targetPath, '.git')
    const stats = await fs.lstat(gitPath)
    return stats.isDirectory() || stats.isFile()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

export async function isGitWorktreeRepo(targetPath: string): Promise<boolean> {
  try {
    return (await fs.lstat(path.join(targetPath, '.git'))).isFile()
  } catch {
    return false
  }
}

export async function findGitRepoRoot(targetPath: string, env: Record<string, string>): Promise<string | null> {
  try {
    const resolvedPath = normalizeAbsolutePath(targetPath)
    const repoRoot = await executeCommand(['git', '-C', resolvedPath, 'rev-parse', '--show-toplevel'], { env, silent: true })
    return normalizeAbsolutePath(repoRoot.trim())
  } catch {
    return null
  }
}

export async function hasCommits(repoPath: string, env: Record<string, string>): Promise<boolean> {
  try {
    await executeCommand(['git', '-C', repoPath, 'rev-parse', 'HEAD'], { env, silent: true })
    return true
  } catch {
    return false
  }
}

export async function isValidGitRepo(repoPath: string, env: Record<string, string>): Promise<boolean> {
  try {
    await executeCommand(['git', '-C', repoPath, 'rev-parse', '--git-dir'], { env, silent: true })
    return true
  } catch {
    return false
  }
}
