import { executeCommand } from '../../utils/process'

export async function gitOut(repoPath: string, args: string[]): Promise<string> {
  return executeCommand(['git', '-C', repoPath, ...args], { silent: true })
}

export async function safeGitOut(repoPath: string, args: string[]): Promise<string | null> {
  try {
    return await gitOut(repoPath, args)
  } catch {
    return null
  }
}
