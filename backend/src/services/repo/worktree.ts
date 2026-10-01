import { executeCommand } from '../../utils/process'
import { swallow } from '../../utils/swallow'
import { resolveDefaultBranch, safeGetCurrentBranch } from './branch'

export async function removeWorktree(baseRepoPath: string, worktreePath: string, env?: Record<string, string>): Promise<void> {
  try {
    await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'remove', '--force', worktreePath], env ? { env } : undefined)
  } catch {
    void 0
  } finally {
    await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'prune'], env ? { env } : undefined).catch(swallow)
  }
  await executeCommand(['rm', '-rf', worktreePath]).catch(swallow)
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
