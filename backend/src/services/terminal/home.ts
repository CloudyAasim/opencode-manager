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

export function resolveUserTerminalHome(userId: string, username?: string | null): string {
  const base = path.resolve(ENV.TERMINAL.CWD)
  if (!ENV.TERMINAL.PER_USER_HOME) return base

  const validUsername = username && /^[a-z][a-z0-9]{2,31}$/.test(username) ? username : null
  const home = validUsername
    ? path.resolve(getUserWorkspacePath(validUsername))
    : path.resolve(base, ENV.TERMINAL.USERS_DIR, safeUserDirectoryName(userId))
  if (!isInsideDirectory(base, home)) {
    logger.warn(`Computed terminal home escapes the workspace root for user ${userId}; using ${base}`)
    return base
  }

  try {
    mkdirSync(home, { recursive: true, mode: 0o700 })
    try {
      chmodSync(home, 0o700)
    } catch {
    void 0
    }
    return home
  } catch {
    logger.warn(`Failed to prepare the per-user terminal home for ${userId}; using ${base}`)
    return base
  }
}
