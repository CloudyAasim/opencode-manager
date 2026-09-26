import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { BrowseDirectoryResponse, DirectoryEntry } from '@opencode-manager/shared/types'

function resolveRoot(configured: string): string {
  const trimmed = (configured ?? '').trim()
  if (!trimmed) {
    throw { message: 'No workspace root is available for this account', statusCode: 403 }
  }
  return path.resolve(trimmed)
}

async function resolveWithinRoot(root: string, requestedPath?: string): Promise<string> {
  const resolved = (!requestedPath || requestedPath.trim() === '') ? root : path.resolve(requestedPath)

  const realRoot = await fs.realpath(root)
  let realResolved: string
  try {
    realResolved = await fs.realpath(resolved)
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw { message: 'Directory not found', statusCode: 404 }
    }
    throw err
  }

  const rel = path.relative(realRoot, realResolved)
  if (rel === '..' || rel.startsWith(`..${path.sep}`)) {
    throw { message: 'Path is outside the allowed browse root', statusCode: 403 }
  }

  return resolved
}

async function isGitRepo(entryPath: string): Promise<boolean> {
  try {
    const stats = await fs.lstat(path.join(entryPath, '.git'))
    return stats.isDirectory() || stats.isFile()
  } catch {
    return false
  }
}

export async function browseDirectory(requestedPath: string | undefined, root: string): Promise<BrowseDirectoryResponse> {
  const resolvedRoot = resolveRoot(root)
  const targetPath = await resolveWithinRoot(resolvedRoot, requestedPath)

  let stats
  try {
    stats = await fs.stat(targetPath)
  } catch {
    throw { message: 'Directory not found', statusCode: 404 }
  }

  if (!stats.isDirectory()) {
    throw { message: 'Path is not a directory', statusCode: 400 }
  }

  const dirEntries = await fs.readdir(targetPath, { withFileTypes: true })
  const directories = dirEntries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))

  const entries: DirectoryEntry[] = await Promise.all(
    directories.map(async (entry) => {
      const entryPath = path.join(targetPath, entry.name)
      return {
        name: entry.name,
        path: entryPath,
        isGitRepo: await isGitRepo(entryPath),
      }
    })
  )

  entries.sort((a, b) => a.name.localeCompare(b.name))

  const isRoot = targetPath === resolvedRoot
  const parentPath = isRoot ? null : path.dirname(targetPath)

  return {
    path: targetPath,
    parentPath,
    isRoot,
    entries,
  }
}
