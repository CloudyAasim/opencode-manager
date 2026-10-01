import { existsSync } from 'node:fs'
import { createRepo, getRepoByLocalPath } from '../../db/queries'
import type { Database } from 'bun:sqlite'
import type { Repo } from '../../types/repo'
import { reposBase } from '../repo-paths'
import { sanitizeBranchForDirectory, getRepoBaseDirectoryName } from '@opencode-manager/shared/utils'
import path from 'path'
import { ConflictError, NotFoundError } from '../../utils/errors'
import { safeGetCurrentBranch } from './branch'
import { createWorktreeSafely, removeWorktree } from './worktree'

export type MirrorTargetPlan =
  | { kind: 'in-place'; repo: Repo; currentBranch: string | null }
  | { kind: 'existing'; repo: Repo; currentBranch: string | null }
  | { kind: 'new'; localPath: string; fullPath: string; currentBranch: string | null }

export async function planMirrorTarget(database: Database, repo: Repo, branch: string): Promise<MirrorTargetPlan> {
  const currentBranch = await safeGetCurrentBranch(repo.fullPath, {})
  if (currentBranch === branch) return { kind: 'in-place', repo, currentBranch }

  const localPath = `${getRepoBaseDirectoryName(repo)}-${sanitizeBranchForDirectory(branch)}`
  const fullPath = path.join(reposBase(), localPath)
  const existing = getRepoByLocalPath(database, localPath)

  if (existing) {
    if (existing.branch !== branch) {
      throw new ConflictError(`Mirror target '${localPath}' is occupied by repo ${existing.id} registered for branch '${existing.branch ?? 'none'}' instead of '${branch}'`)
    }

    if (!existsSync(existing.fullPath)) {
      throw new NotFoundError(`Repo ${existing.id} for branch '${branch}' is missing its worktree directory at '${existing.fullPath}'`)
    }

    const checkedOutBranch = await safeGetCurrentBranch(existing.fullPath, {})
    if (checkedOutBranch !== branch) {
      throw new ConflictError(`Repo ${existing.id} for branch '${branch}' has branch '${checkedOutBranch ?? 'none'}' checked out at '${existing.fullPath}'`)
    }

    return { kind: 'existing', repo: existing, currentBranch }
  }

  return { kind: 'new', localPath, fullPath, currentBranch }
}

export async function ensureMirrorTarget(database: Database, repo: Repo, branch: string): Promise<{ repo: Repo; created: boolean }> {
  const plan = await planMirrorTarget(database, repo, branch)
  if (plan.kind !== 'new') return { repo: plan.repo, created: false }

  await createWorktreeSafely(repo.fullPath, plan.fullPath, branch, {})

  try {
    const worktreeRepo = createRepo(database, repo.repoUrl
      ? { repoUrl: repo.repoUrl, localPath: plan.localPath, sourcePath: plan.fullPath, branch, defaultBranch: branch, cloneStatus: 'ready', clonedAt: Date.now(), isWorktree: true, userId: repo.userId ?? null }
      : { isLocal: true, localPath: plan.localPath, sourcePath: plan.fullPath, branch, defaultBranch: branch, cloneStatus: 'ready', clonedAt: Date.now(), isWorktree: true, userId: repo.userId ?? null })

    if (worktreeRepo.localPath !== plan.localPath) {
      throw new ConflictError(`branch ${branch} is already registered as repo ${worktreeRepo.id} at ${worktreeRepo.fullPath}`)
    }

    return { repo: worktreeRepo, created: true }
  } catch (error: unknown) {
    await removeWorktree(repo.fullPath, plan.fullPath)
    throw error
  }
}

export function ensureMirrorTargetPath(name: string): { fullPath: string; localPath: string } {
  const slugified = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    || 'repo'

  const reposRoot = reposBase()

  let candidate = slugified
  let suffix = 2
  while (existsSync(path.join(reposRoot, candidate))) {
    candidate = `${slugified}-${suffix}`
    suffix += 1
  }

  return {
    fullPath: path.join(reposRoot, candidate),
    localPath: candidate,
  }
}
