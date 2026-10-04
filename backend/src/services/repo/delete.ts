import { executeCommand } from '../../utils/process'
import { getRepoById, deleteRepo } from '../../db/queries'
import type { Database } from 'bun:sqlite'
import { reposBase } from '../repo-paths'
import { NotFoundError } from '../../utils/errors'
import { getErrorMessage } from '../../utils/error-utils'
import { logger } from '../../utils/logger'
import { normalizeRepoUrl } from './clone'
import { resolveRepoPathInsideBase } from './paths'
import { removeWorktree } from './worktree'

export interface DeleteRepoFilesResult {
  /**
   * Whether anything on disk was actually removed. False when the stored path
   * was refused and the row was dropped on its own.
   */
  filesRemoved: boolean
  /** Why the path was refused, when it was. */
  refusal?: string
}

export async function deleteRepoFiles(
  database: Database,
  repoId: number,
): Promise<DeleteRepoFilesResult> {
  const repo = getRepoById(database, repoId)
  if (!repo) {
    throw new NotFoundError(`Repo not found: ${repoId}`)
  }

  const base = reposBase()

  // Before anything is spawned. This is the check that stands between a
  // database column and `rm -rf`; without it, whatever wrote that column
  // decides what gets deleted.
  let target: string
  try {
    target = resolveRepoPathInsideBase(repo.localPath, base)
  } catch (error: unknown) {
    // The guard exists because this column reaches `rm -rf`. A row that cannot
    // pass it is corrupt or hostile - but it is still a row the user can see in
    // their list and asked to have gone. Throwing here would leave them with no
    // way to clear it from the UI at all, which is a worse outcome than
    // leaving a directory on disk that they never wanted deleted anyway.
    //
    // So: drop the reference, touch nothing on disk, and say so. The whole
    // danger lived in the `rm -rf`; the row is harmless.
    const refusal = getErrorMessage(error)
    logger.error(
      `Repo ${repoId} stores local_path '${repo.localPath}', which is outside '${base}'. ` +
        'Removing the database row without touching the filesystem.',
      error,
    )
    deleteRepo(database, repoId)
    return { filesRemoved: false, refusal }
  }

  if (repo.isWorktree && repo.repoUrl) {
    const { name: repoName } = normalizeRepoUrl(repo.repoUrl)
    const baseRepoPath = resolveRepoPathInsideBase(repoName, base)

    const worktreeRemoval = await removeWorktree(baseRepoPath, target)
    if (!worktreeRemoval.removed) {
      // `target` cleared the containment check above, so it is inside the
      // repositories directory - but removeWorktree refused it, which means
      // this row does not describe a worktree of the base repository it names.
      // Falling through to the `rm -rf` below would delete whatever that path
      // actually holds, and a refused path is refused precisely because that
      // is not known. Same handling as the guard above: drop the reference,
      // touch nothing, say why.
      logger.error(
        `Repo ${repoId} is flagged as a worktree but '${repo.localPath}' is not a worktree of '${baseRepoPath}'. ` +
          'Removing the database row without touching the filesystem.',
      )
      deleteRepo(database, repoId)
      return { filesRemoved: false, refusal: worktreeRemoval.refusal }
    }
  }

  // The resolved absolute path, with no cwd: the target no longer depends on
  // where the process happens to be running from.
  await executeCommand(['rm', '-rf', target])
  deleteRepo(database, repoId)
  return { filesRemoved: true }
}
