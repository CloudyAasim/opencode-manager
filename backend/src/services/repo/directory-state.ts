/**
 * The database remembers that a repository was cloned. Nothing ever checked
 * that the directory is still there.
 *
 * `cloneStatus` is written once, by the clone that created the row, and read
 * forever after as if it were current. When the directory disappears - an
 * image rebuild without a volume, a manual cleanup, a failed sync - the row
 * still says 'ready', every guard that tests `cloneStatus` passes, and the
 * session page renders as though it were talking to a real checkout. It is
 * not: OpenCode has nothing to serve for that directory, so the message list
 * stays frozen on whatever it last loaded while the connection indicator
 * still reads healthy. The one call that could have noticed,
 * `safeGetCurrentBranch`, swallows every error and returns null, so the
 * response comes back a cheerful 200.
 *
 * The assistant never had this problem: it stats its own files on every load
 * and rebuilds whatever is missing (services/assistant-mode/service.ts).
 * This module gives repositories the same honesty.
 *
 * Two rules keep the reconciliation from making things worse:
 *
 *  - 'cloning' is left alone. A clone in flight has no directory yet, and
 *    marking it broken would abort work that is succeeding.
 *  - 'error' only becomes 'ready' again when the directory holds a .git entry.
 *    A clone that failed halfway leaves a directory behind without one, and
 *    calling that repository ready would resurrect a broken row.
 */

import fs from 'node:fs'
import path from 'path'
import type { Database } from 'bun:sqlite'
import { listRepos, updateRepoStatus } from '../../db/queries'
import type { Repo } from '../../types/repo'
import { logger } from '../../utils/logger'

export type DirectoryState =
  /** The path is a directory. */
  | 'present'
  /** Provably not a directory: nothing there, or a path component is a file. */
  | 'missing'
  /** Cannot tell - permissions, a symlink loop, an I/O error. */
  | 'unknown'

type StatFn = typeof fs.statSync

/**
 * ENOENT and ENOTDIR are the two ways a path can be definitively absent.
 * Everything else is a failure to *read*, not proof of absence: treating an
 * unreadable directory as a deleted one would destroy a working repository
 * on the strength of a permissions problem.
 */
const ABSENT_CODES = new Set(['ENOENT', 'ENOTDIR'])

export function classifyDirectory(fullPath: string, statSync: StatFn = fs.statSync): DirectoryState {
  if (!fullPath) return 'missing'

  let stats: fs.Stats | undefined
  try {
    stats = statSync(fullPath, { throwIfNoEntry: false })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code && ABSENT_CODES.has(code) ? 'missing' : 'unknown'
  }

  if (stats === undefined) return 'missing'
  return stats.isDirectory() ? 'present' : 'missing'
}

export interface DirectoryProbe {
  state: DirectoryState
  /**
   * False only when the directory is provably gone. 'unknown' counts as
   * present, because "I could not check" must not read as "it is deleted".
   */
  directoryExists: boolean
  /**
   * A clone leaves a directory (and a .git entry) behind; a worktree leaves a
   * .git *file* pointing at its parent. Both count, a failed clone does not.
   */
  looksLikeCheckout: boolean
}

export function probeRepoDirectory(fullPath: string, statSync: StatFn = fs.statSync): DirectoryProbe {
  const state = classifyDirectory(fullPath, statSync)

  // False only when the directory is provably gone. 'unknown' counts as
  // present, and this is the one line that has to hold: the API hands the value
  // straight to the session page, which puts a "re-clone this repository" screen
  // in front of anyone whose directory merely could not be read.
  const directoryExists = state !== 'missing'
  if (!directoryExists) {
    return { state, directoryExists, looksLikeCheckout: false }
  }

  let gitEntry: fs.Stats | undefined
  try {
    gitEntry = statSync(path.join(fullPath, '.git'), { throwIfNoEntry: false })
  } catch {
    // An unreadable .git tells us nothing about the checkout; treat the
    // directory itself as intact and let git be the judge.
    return { state, directoryExists, looksLikeCheckout: false }
  }

  return { state, directoryExists, looksLikeCheckout: gitEntry !== undefined }
}

export interface ReconcileEntry {
  id: number
  localPath: string
  fullPath: string
  from: Repo['cloneStatus']
  to: Repo['cloneStatus']
}

export interface ReconcileReport {
  checked: number
  /** 'ready' rows whose directory is provably gone. */
  markedMissing: ReconcileEntry[]
  /** 'error' rows whose directory is back and holds a .git entry. */
  markedRestored: ReconcileEntry[]
  /** Paths that could not be read. Left exactly as they were. */
  unreadable: string[]
  /** Rows skipped because a clone is in flight. */
  inFlight: number
}

export function reconcileRepoDirectories(
  database: Database,
  deps: {
    repos?: Repo[]
    probe?: (fullPath: string) => DirectoryProbe
    setStatus?: (id: number, status: Repo['cloneStatus']) => void
  } = {}
): ReconcileReport {
  const repos = deps.repos ?? listRepos(database)
  const probe = deps.probe ?? probeRepoDirectory
  const setStatus =
    deps.setStatus ?? ((id: number, status: Repo['cloneStatus']) => updateRepoStatus(database, id, status))

  const report: ReconcileReport = {
    checked: repos.length,
    markedMissing: [],
    markedRestored: [],
    unreadable: [],
    inFlight: 0,
  }

  for (const repo of repos) {
    if (repo.cloneStatus === 'cloning') {
      report.inFlight += 1
      continue
    }

    const result = probe(repo.fullPath)

    if (result.state === 'unknown') {
      report.unreadable.push(repo.fullPath)
      continue
    }

    if (repo.cloneStatus === 'ready' && !result.directoryExists) {
      setStatus(repo.id, 'error')
      report.markedMissing.push({
        id: repo.id,
        localPath: repo.localPath,
        fullPath: repo.fullPath,
        from: 'ready',
        to: 'error',
      })
      continue
    }

    if (repo.cloneStatus === 'error' && result.looksLikeCheckout) {
      setStatus(repo.id, 'ready')
      report.markedRestored.push({
        id: repo.id,
        localPath: repo.localPath,
        fullPath: repo.fullPath,
        from: 'error',
        to: 'ready',
      })
    }
  }

  return report
}

export function formatMissingDirectoriesWarning(report: ReconcileReport): string {
  const lines = [
    '',
    '================================================================',
    ' REPOSITORY DIRECTORY MISSING',
    '================================================================',
    ' These repositories are recorded as ready in the database, but their',
    ' directory is not on disk. Sessions in them cannot load messages and',
    ' will sit on a stale view of the conversation:',
    ...report.markedMissing.map((entry) => `   - ${entry.localPath} (${entry.fullPath})`),
    '',
    ' Their status has been set to "error" so they stop pretending to work.',
    ' Restore the directory (re-clone it, or mount the volume it lived on)',
    ' and restart - a checkout that is back with its .git is marked ready',
    ' again automatically.',
    '================================================================',
    '',
  ]

  return lines.join('\n')
}

export function logDirectoryReconciliation(report: ReconcileReport): void {
  if (report.markedMissing.length > 0) {
    logger.error(formatMissingDirectoriesWarning(report))
  }
  if (report.markedRestored.length > 0) {
    logger.info(
      `Repository directories restored: ${report.markedRestored.map((entry) => entry.localPath).join(', ')}`
    )
  }
  if (report.unreadable.length > 0) {
    logger.warn(
      `Could not read ${report.unreadable.length} repository director(ies); left their status untouched: ${report.unreadable.join(', ')}`
    )
  }
}
