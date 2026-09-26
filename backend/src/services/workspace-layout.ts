import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Dirent } from 'node:fs'
import { getUsersWorkspacePath } from '@opencode-manager/shared/config/env'
import { logger } from '../utils/logger'

const SETTING_ENTRIES = new Set(['assistant', 'opencode.json'])

async function moveIfMissing(from: string, to: string): Promise<void> {
  try {
    await fs.access(to)
    return
  } catch {
    // target does not exist; move below
  }
  try {
    await fs.rename(from, to)
  } catch (error) {
    logger.warn(`Failed to move ${from} to ${to}`, error)
  }
}

/**
 * Moves any pre-existing `users/<username>/*` content into the split layout:
 * `workspace/` for projects and files, `setting/` for configuration and the
 * assistant workspace. Idempotent and safe to run on every start.
 */
export async function migrateUserWorkspaceLayout(): Promise<void> {
  const usersRoot = getUsersWorkspacePath()
  let usernames: string[]
  try {
    usernames = (await fs.readdir(usersRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return
  }

  for (const username of usernames) {
    const userRoot = path.join(usersRoot, username)
    let entries: Dirent[]
    try {
      entries = await fs.readdir(userRoot, { withFileTypes: true })
    } catch {
      continue
    }

    const legacy = entries.filter((entry) => entry.name !== 'workspace' && entry.name !== 'setting')
    if (legacy.length === 0) continue

    const workspaceDir = path.join(userRoot, 'workspace')
    const settingDir = path.join(userRoot, 'setting')
    await fs.mkdir(workspaceDir, { recursive: true })
    await fs.mkdir(settingDir, { recursive: true })

    for (const entry of legacy) {
      const from = path.join(userRoot, entry.name)
      const to = SETTING_ENTRIES.has(entry.name)
        ? path.join(settingDir, entry.name)
        : path.join(workspaceDir, entry.name)
      await moveIfMissing(from, to)
    }

    logger.info(`Migrated workspace layout for user: ${username}`)
  }
}
