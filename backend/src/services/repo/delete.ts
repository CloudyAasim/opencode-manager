import { executeCommand } from '../../utils/process'
import { getRepoById, deleteRepo } from '../../db/queries'
import type { Database } from 'bun:sqlite'
import { reposBase } from '../repo-paths'
import path from 'path'
import { NotFoundError } from '../../utils/errors'
import { normalizeRepoUrl } from './clone'
import { removeWorktree } from './worktree'

export async function deleteRepoFiles(database: Database, repoId: number): Promise<void> {
  const repo = getRepoById(database, repoId)
  if (!repo) {
    throw new NotFoundError(`Repo not found: ${repoId}`)
  }

  const fullPath = path.resolve(reposBase(), repo.localPath)

  if (repo.isWorktree && repo.repoUrl) {
    const { name: repoName } = normalizeRepoUrl(repo.repoUrl)
    const baseRepoPath = path.resolve(reposBase(), repoName)

    await removeWorktree(baseRepoPath, fullPath)
  }

  await executeCommand(['rm', '-rf', repo.localPath], reposBase())
  deleteRepo(database, repoId)
}
