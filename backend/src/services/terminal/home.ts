import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { ENV, getUserWorkspacePath } from '@opencode-manager/shared/config/env'
import { logger } from '../../utils/logger'

export function safeUserDirectoryName(userId: string): string {
  const hash = createHash('sha256').update(userId).digest('hex').slice(0, 8)
  const stem = userId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'user'
  return `${stem}-${hash}`
}

export function isInsideDirectory(base: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(base), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * The directory a non-admin's shell is confined to, or `null` when there isn't
 * one.
 *
 * `null` means this person cannot be confined, and every caller must refuse
 * rather than substitute something. The tempting substitute is the workspace
 * root, which is where this function used to fall back to - and that is the
 * one directory guaranteed to contain everybody's data, so falling back to it
 * means "no isolation" wearing the label "isolated". A `mkdirSync` that throws
 * because the disk is full is enough to get there.
 *
 * So each failure below returns `null` and says which one it was; the caller
 * turns that into `TERMINAL_SANDBOX_UNAVAILABLE`.
 */
export function resolveUserTerminalHome(userId: string, username?: string | null): string | null {
  const base = path.resolve(ENV.TERMINAL.CWD)

  // With per-user homes off there is no directory that holds only this
  // person's files. Admin sessions are unaffected - they are handed the
  // container on purpose - but a non-admin with nowhere of their own has
  // nothing to be confined to.
  if (!ENV.TERMINAL.PER_USER_HOME) {
    logger.error(
      `Cannot confine terminal sessions for user ${userId}: OCM_TERMINAL_PER_USER_HOME is false, ` +
      `so there is no per-user directory. Refusing rather than binding the shared workspace, ` +
      `which holds every user's data.`,
    )
    return null
  }

  const validUsername = username && /^[a-z][a-z0-9]{2,31}$/.test(username) ? username : null
  const home = validUsername
    ? path.resolve(getUserWorkspacePath(validUsername))
    : path.resolve(base, ENV.TERMINAL.USERS_DIR, safeUserDirectoryName(userId))
  if (!isInsideDirectory(base, home)) {
    logger.error(
      `Computed terminal home escapes the workspace root for user ${userId} (${home} is outside ${base}). ` +
      `Refusing rather than binding the workspace root.`,
    )
    return null
  }

  try {
    mkdirSync(home, { recursive: true, mode: 0o700 })
    try {
      chmodSync(home, 0o700)
    } catch {
    void 0
    }
    return home
  } catch (error) {
    logger.error(
      `Failed to prepare the per-user terminal home for user ${userId} (${home}): ` +
      `${error instanceof Error ? error.message : String(error)}. ` +
      `Refusing rather than binding the workspace root, which holds every user's data.`,
    )
    return null
  }
}
