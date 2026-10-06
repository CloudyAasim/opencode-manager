import path from 'path'
import type { Database } from 'bun:sqlite'
import { getUserReposPath } from '@opencode-manager/shared/config/env'
import type { Repo } from '../../types/repo'
import { findUserIdentity } from '../../auth/ownership'
import { getAccessScope } from '../../auth/access-scope'
import { UserProviderService } from '../user-providers'
import { logger } from '../../utils/logger'

/**
 * Puts a tenant's own providers back into a repository directory.
 *
 * OpenCode resolves a session's configuration by walking up from the session's
 * working directory, and that directory is a checkout. So a declaration written
 * while a repository already existed is simply not in effect there: the models
 * and endpoint the tenant declared do not exist for sessions in that project,
 * and nothing says why. This is called when a repository becomes ready, and by
 * the reconciler, so the answer does not depend on what order things happened
 * in.
 *
 * Credentials go through the same call, because they have exactly the same
 * problem and had it first.
 *
 * Three cases deliberately do nothing:
 *
 * - No username. A user whose row has no `username` has no settings directory
 *   of their own, and guessing `userId` as a stand-in would create one and
 *   write tenant state into the wrong place.
 * - A checkout outside this tenant's own projects directory. A repository
 *   registered from an existing local path is reached through a symlink and
 *   `repo.fullPath` is the real directory somewhere else entirely. Writing a
 *   provider file into a checkout the app does not own is not a side effect
 *   worth taking quietly.
 * - Any failure. A repository that has just been cloned is a repository the
 *   user is waiting on; failing the request because a config file could not be
 *   written would be trading a working clone for a clearer error about a
 *   detail they never asked about.
 */
export async function syncUserProviderConfigForRepo(
  database: Database,
  repo: Pick<Repo, 'fullPath' | 'userId'>,
): Promise<void> {
  try {
    const username = getAccessScope()?.username
      ?? (repo.userId ? findUserIdentity(database, repo.userId)?.username : null)
      ?? null
    if (!username) return

    const target = path.resolve(repo.fullPath)
    const ownReposRoot = path.resolve(getUserReposPath(username))
    if (target !== ownReposRoot && !target.startsWith(`${ownReposRoot}${path.sep}`)) {
      logger.debug(`Skipping provider config for a checkout outside the user's projects directory: ${target}`)
      return
    }

    await new UserProviderService().syncIntoRepo(username, target)
  } catch (error) {
    logger.error(`Failed to apply provider configuration to ${repo.fullPath}:`, error)
  }
}
