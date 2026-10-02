import type { GitStatusResponse } from '@/types/git'

/**
 * Moving a file across the staged line is a pure function of the paths the
 * user picked - the server is going to agree with us, just not for another
 * few hundred milliseconds. Doing it locally first is what makes staging a
 * file feel like staging a file instead of wondering whether the click
 * landed. The response then replaces this wholesale.
 *
 * Each of these hands back the *same* object when it would change nothing.
 * That is not a micro-optimisation: the file list is rendered from this, and a
 * fresh array on a no-op would re-render every row for nothing.
 */
export function withStagedPaths(
  status: GitStatusResponse,
  paths: string[],
  staged: boolean,
): GitStatusResponse {
  if (paths.length === 0) return status
  const picked = new Set(paths)
  let changed = false
  const files = status.files.map((file) => {
    if (!picked.has(file.path) || file.staged === staged) return file
    changed = true
    return { ...file, staged }
  })
  if (!changed) return status
  return { ...status, files, hasChanges: files.length > 0 }
}

/** A discarded file is gone, not just moved, so it leaves the list entirely. */
export function withoutPaths(status: GitStatusResponse, paths: string[]): GitStatusResponse {
  if (paths.length === 0) return status
  const picked = new Set(paths)
  const files = status.files.filter((file) => !picked.has(file.path))
  if (files.length === status.files.length) return status
  return { ...status, files, hasChanges: files.length > 0 }
}
