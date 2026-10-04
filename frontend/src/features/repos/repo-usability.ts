/**
 * One definition of "this repository can actually be worked with", so the card,
 * the row actions and the session page cannot drift apart.
 *
 * cloneStatus alone cannot answer it. That field records what the clone did
 * once, at the time it happened; the directory it refers to can be gone by the
 * next deploy. Reading it as the present tense is how a repository whose files
 * had disappeared kept rendering as a healthy, green, clickable project.
 *
 * So the two questions are kept apart on purpose:
 *
 *  - hasMissingDirectory is a fact about right now, measured per response.
 *  - isRepoUsable decides whether actions are offered. An action against a
 *    directory that is not there would fail, and it would fail at the far end,
 *    after the user has already committed to it.
 *
 * directoryExists is optional because an older backend does not send it.
 * Absent is not false: only a backend that measured the directory and said no
 * is evidence that it is gone.
 */

export interface RepoDirectoryState {
  cloneStatus?: string
  directoryExists?: boolean
}

/** The checkout directory is provably not on disk. */
export function hasMissingDirectory(repo: RepoDirectoryState): boolean {
  return repo.directoryExists === false
}

/** Cloned, and the directory it points at is still there. */
export function isRepoUsable(repo: RepoDirectoryState): boolean {
  return repo.cloneStatus === 'ready' && !hasMissingDirectory(repo)
}

/**
 * Whether the session page may be opened. A repository whose directory is gone
 * is still worth opening: the session page is where the missing path gets named,
 * and blocking the click would hide the only place that explains the problem.
 */
export function canOpenRepo(repo: RepoDirectoryState): boolean {
  return repo.cloneStatus === 'ready'
}
