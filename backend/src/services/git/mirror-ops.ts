import { spawn } from 'child_process'
import { copyFileSync, existsSync, mkdtempSync } from 'fs'
import * as fsp from 'fs/promises'
import { join } from 'path'
import { getReposPath } from '@opencode-manager/shared/config/env'
import { ConflictError, ValidationError } from '../../utils/errors'
import { mkdirSyncSafe } from '../../utils/fs-safe'
import { swallow } from '../../utils/swallow'
import { getStagingRoot } from '../uploads/mirror-staging'
import { safeGitOut } from './git-commands'

function gitRaw(repoPath: string, args: string[], env: NodeJS.ProcessEnv = process.env, input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: repoPath, env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || `git exited with code ${code}`))
    })
    if (input !== undefined) child.stdin.end(input)
  })
}

export async function createMirrorPatch(fullPath: string): Promise<string> {
  const untracked = (await gitRaw(fullPath, ['ls-files', '--others', '--exclude-standard', '-z']).catch(() => ''))
    .split('\0')
    .filter(Boolean)
  if (untracked.length === 0) return gitRaw(fullPath, ['diff', '--binary', 'HEAD', '--'])

  const indexPath = (await safeGitOut(fullPath, ['rev-parse', '--git-path', 'index']))?.trim()
  const tempIndexDir = mkdtempSync(join(getReposPath(), '.ocm-index-'))
  const tempIndex = join(tempIndexDir, 'index')
  const env = { ...process.env, GIT_INDEX_FILE: tempIndex }

  try {
    if (indexPath && existsSync(join(fullPath, indexPath))) {
      copyFileSync(join(fullPath, indexPath), tempIndex)
    }
    await gitRaw(fullPath, ['add', '-N', '--', ...untracked], env)
    return gitRaw(fullPath, ['diff', '--binary', 'HEAD', '--'], env)
  } finally {
    await fsp.rm(tempIndexDir, { recursive: true, force: true }).catch(swallow)
  }
}

export async function applyMirrorPatch(fullPath: string, patch: string): Promise<void> {
  if (!patch) return
  await gitRaw(fullPath, ['apply', '--binary', '--whitespace=nowarn', '-'], process.env, patch)
}

async function branchesCheckedOutElsewhere(fullPath: string): Promise<Set<string>> {
  const ownBranch = (await gitRaw(fullPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim()
  const out = await gitRaw(fullPath, ['for-each-ref', '--format=%(refname:strip=2) %(worktreepath)', 'refs/heads'])
  const locked = new Set<string>()
  for (const line of out.split('\n')) {
    const firstSpace = line.indexOf(' ')
    if (firstSpace === -1) continue
    const name = line.slice(0, firstSpace)
    const worktreePath = line.slice(firstSpace + 1).trim()
    if (worktreePath && name !== ownBranch) locked.add(name)
  }
  return locked
}

async function currentBranchName(fullPath: string): Promise<string | null> {
  const out = await gitRaw(fullPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')
  const trimmed = out.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function listLocalBranchNames(fullPath: string): Promise<Set<string>> {
  const out = await gitRaw(fullPath, ['for-each-ref', '--format=%(refname:strip=2)', 'refs/heads'])
  return new Set(out.split('\n').map((l) => l.trim()).filter(Boolean))
}

export async function importBundle(fullPath: string, bundlePath: string, branch: string | null, requireCurrentBranch: boolean, force: boolean): Promise<void> {
  await gitRaw(fullPath, ['fetch', bundlePath, '+refs/heads/*:refs/remotes/ocm-sync/*', '+refs/tags/*:refs/tags/*'])
  try {
    const refs = await gitRaw(fullPath, ['for-each-ref', '--format=%(refname:strip=3) %(objectname)', 'refs/remotes/ocm-sync'])
    const incoming = new Map<string, string>()
    for (const line of refs.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const firstSpace = trimmed.indexOf(' ')
      if (firstSpace === -1) continue
      const name = trimmed.slice(0, firstSpace)
      if (name === 'HEAD') continue
      incoming.set(name, trimmed.slice(firstSpace + 1))
    }

    const locked = await branchesCheckedOutElsewhere(fullPath)
    const actualBranch = await currentBranchName(fullPath)

    let targetSha: string | undefined
    if (branch) {
      const incomingSha = incoming.get(branch)
      if (!incomingSha) throw new ValidationError(`incoming bundle has no branch '${branch}'`)
      if (locked.has(branch)) {
        throw new ConflictError(`branch '${branch}' is checked out in another worktree; release it there before pushing`)
      }
      if (requireCurrentBranch && actualBranch !== branch) {
        throw new ConflictError(`repo is on branch '${actualBranch ?? 'detached HEAD'}' but the bundle targets '${branch}'`)
      }
      targetSha = incomingSha
      if (actualBranch !== branch) {
        const checkoutArgs = force ? ['-f'] : []
        if ((await listLocalBranchNames(fullPath)).has(branch)) {
          await gitRaw(fullPath, ['checkout', ...checkoutArgs, branch])
        } else {
          await gitRaw(fullPath, ['checkout', ...checkoutArgs, '-b', branch, incomingSha])
        }
      }
    }

    const updates: string[] = []
    for (const [name, sha] of incoming) {
      if (targetSha !== undefined && name === branch) continue
      if (locked.has(name)) continue
      updates.push(`update refs/heads/${name} ${sha}\n`)
    }
    if (updates.length > 0) {
      await gitRaw(fullPath, ['update-ref', '--stdin'], process.env, updates.join(''))
    }

    if (branch && targetSha !== undefined) {
      await gitRaw(fullPath, ['reset', '--hard', targetSha])
      await gitRaw(fullPath, ['clean', '-fd'])
    }
  } finally {
    const syncRefsOut = await gitRaw(fullPath, ['for-each-ref', '--format=%(refname)', 'refs/remotes/ocm-sync']).catch(() => '')
    const deletes = syncRefsOut.split('\n').map((l) => l.trim()).filter(Boolean).map((ref) => `delete ${ref}\n`)
    if (deletes.length > 0) {
      await gitRaw(fullPath, ['update-ref', '--stdin'], process.env, deletes.join('')).catch(swallow)
    }
  }
}

export async function createBundle(fullPath: string): Promise<string> {
  const stagingRoot = getStagingRoot()
  mkdirSyncSafe(stagingRoot)
  const bundleDir = mkdtempSync(join(stagingRoot, 'bundle-'))
  const bundlePath = join(bundleDir, 'repo.bundle')
  await gitRaw(fullPath, ['bundle', 'create', bundlePath, '--all'])
  return bundlePath
}
