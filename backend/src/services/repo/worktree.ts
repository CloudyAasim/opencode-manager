import fs from 'fs/promises'
import path from 'path'
import { executeCommand } from '../../utils/process'
import { swallow } from '../../utils/swallow'
import { logger } from '../../utils/logger'
import { resolveDefaultBranch, safeGetCurrentBranch } from './branch'
import { pathExists } from './paths'

export interface RemoveWorktreeResult {
  /**
   * Whether the worktree directory is gone. False when the path was refused
   * and nothing on disk was touched.
   */
  removed: boolean
  /** Why the path was refused, when it was. */
  refusal?: string
}

async function realPathOrSelf(target: string): Promise<string> {
  try {
    return await fs.realpath(target)
  } catch {
    return path.resolve(target)
  }
}

/**
 * The repository a directory really belongs to, according to git.
 *
 * A linked worktree and the repository it hangs off share one common git dir,
 * so two paths answering the same value are the same repository. Asking git
 * both questions also avoids guessing where the base's git dir lives, which is
 * a directory for a normal checkout and a file for one that is itself a
 * worktree.
 */
async function gitCommonDir(repoPath: string, env?: Record<string, string>): Promise<string | null> {
  try {
    const out = await executeCommand(['git', '-C', repoPath, 'rev-parse', '--git-common-dir'], {
      ...(env ? { env } : {}),
      silent: true,
    })
    // Git prints a path relative to the directory it was pointed at for a
    // repository's own git dir, and an absolute one for a linked worktree's, so
    // resolving against repoPath covers both without requiring a git new
    // enough for --path-format=absolute.
    return await realPathOrSelf(path.resolve(repoPath, out.trim()))
  } catch {
    return null
  }
}

/**
 * Why `worktreePath` must not be deleted, or null when it may be.
 *
 * The `rm -rf` at the end of `removeWorktree` has no idea what it is pointed
 * at, and `worktreePath` reaches it from three places: a database column
 * (delete), a mirror plan (mirror), and - the reason this check exists - the
 * `directory` field of an OpenCode workspace API response, used verbatim
 * (schedule-worktree). Whatever that third party hands back is what gets
 * removed, so the path has to earn the `rm -rf` before anything is spawned.
 *
 * The check is intrinsic on purpose. `assertWithinAccessScope` is the obvious
 * candidate and it is the wrong tool: it returns silently when no scope is
 * set, and nothing outside the HTTP middleware sets one. Scheduled runs and
 * mirrored checkouts have no scope, so a guard built on it would be a no-op on
 * exactly the paths that reach here, and would go green while doing nothing.
 *
 * A directory holding no worktree of this base is refused even when it sits
 * somewhere legitimate. Worktrees are allowed outside every root this codebase
 * knows about - the OpenCode workspace API is explicitly used as-is wherever
 * it puts them - so "is it under a root we recognise" is not a question with
 * one answer. "Does git say this belongs to the repository we are removing a
 * worktree from" is.
 */
async function findWorktreeRefusal(baseRepoPath: string, worktreePath: string, env?: Record<string, string>): Promise<string | null> {
  // Nothing on disk: there is no directory to take with us. Let the caller
  // through so the prune below still clears a registration an earlier crash
  // left behind.
  if (!(await pathExists(worktreePath))) {
    return null
  }

  // Checked before the git question, and not as a substitute for it: a symlink
  // pointing at the base repository reports the same common git dir as the
  // base itself, so git alone cannot tell "remove a worktree of this" from
  // "remove the main checkout through a different name".
  if ((await realPathOrSelf(worktreePath)) === (await realPathOrSelf(baseRepoPath))) {
    return `it resolves to the base repository '${baseRepoPath}' itself, and removing it would take the main checkout with it`
  }

  const targetCommonDir = await gitCommonDir(worktreePath, env)
  if (targetCommonDir === null) {
    return `git does not recognise '${worktreePath}' as a repository, so nothing ties it to '${baseRepoPath}'`
  }

  const baseCommonDir = await gitCommonDir(baseRepoPath, env)
  if (baseCommonDir === null) {
    return `git could not identify a common git directory for the base repository '${baseRepoPath}'`
  }

  if (targetCommonDir !== baseCommonDir) {
    return `it belongs to a different repository (common git dir '${targetCommonDir}' is not '${baseCommonDir}')`
  }

  return null
}

export async function removeWorktree(
  baseRepoPath: string,
  worktreePath: string,
  env?: Record<string, string>,
): Promise<RemoveWorktreeResult> {
  // Before anything is spawned. `git worktree remove` failing is not a guard -
  // it is swallowed just below, and the `rm -rf` that follows runs either way,
  // so the path has to be checked here or not at all.
  const refusal = await findWorktreeRefusal(baseRepoPath, worktreePath, env)
  if (refusal) {
    // Logged here rather than by the caller: every caller either swallows the
    // result or ignores it, and a worktree nobody cleans up should not be a
    // directory that quietly stays forever.
    logger.error(
      `Refusing to remove worktree '${worktreePath}': ${refusal}. Nothing on disk was touched.`,
    )
    return { removed: false, refusal }
  }

  try {
    await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'remove', '--force', worktreePath], env ? { env } : undefined)
  } catch {
    void 0
  } finally {
    await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'prune'], env ? { env } : undefined).catch(swallow)
  }
  await executeCommand(['rm', '-rf', worktreePath]).catch(swallow)
  return { removed: true }
}

export async function createWorktreeSafely(baseRepoPath: string, worktreePath: string, branch: string, env: Record<string, string>, baseBranch?: string): Promise<void> {
  const currentBranch = await safeGetCurrentBranch(baseRepoPath, env)
  if (currentBranch === branch) {
    const defaultBranch = await resolveDefaultBranch(baseRepoPath, env)

    await executeCommand(['git', '-C', baseRepoPath, 'checkout', defaultBranch], { env })
      .catch(() => executeCommand(['git', '-C', baseRepoPath, 'checkout', 'main'], { env }))
  }

  await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'prune'], { env }).catch(swallow)

  let branchExists = false
  try {
    await executeCommand(['git', '-C', baseRepoPath, 'rev-parse', '--verify', `refs/heads/${branch}`], { env, silent: true })
    branchExists = true
  } catch {
    try {
      await executeCommand(['git', '-C', baseRepoPath, 'rev-parse', '--verify', `refs/remotes/origin/${branch}`], { env, silent: true })
      branchExists = true
    } catch {
      branchExists = false
    }
  }

  if (branchExists) {
    await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'add', worktreePath, branch], { env })
  } else {
    const addArgs = ['git', '-C', baseRepoPath, 'worktree', 'add', '-b', branch, worktreePath]
    if (baseBranch) {
      addArgs.push(baseBranch)
    }
    await executeCommand(addArgs, { env })
  }
}
