import fs from 'fs/promises'
import type { Database } from 'bun:sqlite'
import type { GitAuthService } from '../git-auth'
import { resolveAccessRoots, resolveBrowseRoot, resolveRepoBase, type Principal } from '../../auth/ownership'
import { runWithAccessScope } from '../../auth/access-scope'
import { ASSISTANT_REPO_PATH } from '@opencode-manager/shared/utils'
import { discoverLocalRepos } from './discovery'
import { logger } from '../../utils/logger'
import path from 'path'

/**
 * Direct children plus one level of grouping. A projects folder is a flat list
 * of checkouts; `group/repo` is the only shape deeper than that, and anything
 * deeper is someone's build output rather than a project.
 */
const RECONCILE_MAX_DEPTH = 2

/**
 * The project list is refetched on every navigation, and a walk of the
 * projects directory is not free. Once a minute is far more often than a
 * person adds a project, and it means "I cloned it and it showed up" still
 * holds without a page reload.
 */
const RECONCILE_MIN_INTERVAL_MS = 60_000

const lastReconcileAt = new Map<string, number>()

export interface ReconcileReposResult {
  registeredCount: number
  existingCount: number
  /** True when the scan was rate-limited and nothing was looked at. */
  skipped: boolean
  errors: Array<{ path: string; error: string }>
}

/**
 * Registers git repositories sitting in the user's projects directory that the
 * database has never heard of.
 *
 * Projects reach the projects directory from more places than this app's own
 * API. The assistant runs `git clone` in a shell, a user clones by hand, a
 * directory gets moved. Every one of those produced the same bug: a real
 * repository sitting in the projects folder that never appears as a project,
 * because registration only ever happened as a side effect of the UI calling
 * `POST /repos` or `POST /repos/discover`.
 *
 * The rule this enforces is "a directory in the projects folder is a project".
 * That is also the answer to "I deleted the project but the directory is still
 * there": deleting a project removes the row and the directory together, so a
 * project that comes back means the directory came back.
 */
export async function reconcileUserRepos(
  database: Database,
  gitAuthService: GitAuthService,
  principal: Principal | null,
  options: { force?: boolean } = {},
): Promise<ReconcileReposResult> {
  if (!principal) {
    return { registeredCount: 0, existingCount: 0, skipped: true, errors: [] }
  }

  if (!options.force) {
    const last = lastReconcileAt.get(principal.id) ?? 0
    if (Date.now() - last < RECONCILE_MIN_INTERVAL_MS) {
      return { registeredCount: 0, existingCount: 0, skipped: true, errors: [] }
    }
  }
  lastReconcileAt.set(principal.id, Date.now())

  const repoBase = resolveRepoBase(principal)

  // The projects directory is created along with the first project. "Not there
  // yet" is the normal state of a fresh account, not something to log.
  try {
    await fs.access(repoBase)
  } catch {
    return { registeredCount: 0, existingCount: 0, skipped: false, errors: [] }
  }

  // An explicit scope rather than an inherited one. The walk reaches
  // `reposBase()`, which falls back to the *global* projects directory when no
  // scope is set - so a caller running this outside a request would quietly
  // scan a directory that is not this user's. See `assertWithinAccessScope` for
  // why that fallback is the dangerous kind of default and why this is not.
  const result = await runWithAccessScope(
    {
      roots: resolveAccessRoots(database, principal),
      browseRoot: resolveBrowseRoot(principal),
      repoBase,
      username: principal.username ?? null,
    },
    () => discoverLocalRepos(database, gitAuthService, repoBase, RECONCILE_MAX_DEPTH, principal.id, [
      // The Assistant lives inside the global projects directory and is built
      // on demand rather than stored, so it has no row to match against. Left
      // in, it registers as a phantom project that duplicates the Assistant
      // the app already shows.
      path.join(repoBase, ASSISTANT_REPO_PATH),
    ]),
  )

  if (result.discoveredCount > 0 || result.errors.length > 0) {
    logger.info(
      `Reconciled projects for user ${principal.id}: ${result.discoveredCount} new, ` +
        `${result.existingCount} known, ${result.errors.length} error(s) in '${repoBase}'`,
    )
  }
  for (const failure of result.errors) {
    logger.warn(`Could not register project at '${failure.path}': ${failure.error}`)
  }

  return {
    registeredCount: result.discoveredCount,
    existingCount: result.existingCount,
    skipped: false,
    errors: result.errors,
  }
}

/** Test-only: drops the per-user rate limit so each case starts clean. */
export function resetReconcileThrottle(): void {
  lastReconcileAt.clear()
}
