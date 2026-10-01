import fs from 'fs/promises'
import { executeCommand } from '../../utils/process'
import path from 'path'

export function normalizeInputPath(input: string): string {
  return input.trim().replace(/[\\/]+$/, '')
}

export function normalizeAbsolutePath(input: string): string {
  return path.resolve(normalizeInputPath(input))
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.lstat(targetPath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

export async function isGitRepoRootPath(targetPath: string): Promise<boolean> {
  try {
    const gitPath = path.join(targetPath, '.git')
    const stats = await fs.lstat(gitPath)
    return stats.isDirectory() || stats.isFile()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

export async function isGitWorktreeRepo(targetPath: string): Promise<boolean> {
  try {
    return (await fs.lstat(path.join(targetPath, '.git'))).isFile()
  } catch {
    return false
  }
}

export async function findGitRepoRoot(targetPath: string, env: Record<string, string>): Promise<string | null> {
  try {
    const resolvedPath = normalizeAbsolutePath(targetPath)
    const repoRoot = await executeCommand(['git', '-C', resolvedPath, 'rev-parse', '--show-toplevel'], { env, silent: true })
    return normalizeAbsolutePath(repoRoot.trim())
  } catch {
    return null
  }
}

export async function hasCommits(repoPath: string, env: Record<string, string>): Promise<boolean> {
  try {
    await executeCommand(['git', '-C', repoPath, 'rev-parse', 'HEAD'], { env, silent: true })
    return true
  } catch {
    return false
  }
}

export async function isValidGitRepo(repoPath: string, env: Record<string, string>): Promise<boolean> {
  try {
    await executeCommand(['git', '-C', repoPath, 'rev-parse', '--git-dir'], { env, silent: true })
    return true
  } catch {
    return false
  }
}
