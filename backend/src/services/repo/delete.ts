import { executeCommand } from '../../utils/process'
import { getRepoById, deleteRepo } from '../../db/queries'
import type { Database } from 'bun:sqlite'
import { reposBase } from '../repo-paths'
import { NotFoundError } from '../../utils/errors'
import { normalizeRepoUrl } from './clone'
import { resolveRepoPathInsideBase } from './paths'
import { removeWorktree } from './worktree'

export async function deleteRepoFiles(database: Database, repoId: number): Promise<void> {
  const repo = getRepoById(database, repoId)
  if (!repo) {
    throw new NotFoundError(`Repo not found: ${repoId}`)
  }

  const base = reposBase()

  // Before anything is spawned. This is the check that stands between a
  // database column and `rm -rf`; without it, whatever wrote that column
  // decides what gets deleted.
  const target = resolveRepoPathInsideBase(repo.localPath, base)

  if (repo.isWorktree && repo.repoUrl) {
    const { name: repoName } = normalizeRepoUrl(repo.repoUrl)
    const baseRepoPath = resolveRepoPathInsideBase(repoName, base)

    await removeWorktree(baseRepoPath, target)
  }

  // The resolved absolute path, with no cwd: the target no longer depends on
  // where the process happens to be running from.
  await executeCommand(['rm', '-rf', target])
  deleteRepo(database, repoId)
}
