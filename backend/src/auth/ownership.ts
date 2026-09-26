import type { Database } from 'bun:sqlite'
import path from 'node:path'
import type { Session } from './index'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import { getReposPath, getUserWorkspacePath, getWorkspacePath } from '@opencode-manager/shared/config/env'

export interface Principal {
  id: string
  role: 'admin' | 'user'
  username?: string | null
}

export function principalFrom(user: Session['user'] | undefined | null): Principal | null {
  if (!user?.id) return null
  return { id: user.id, role: user.role === 'admin' ? 'admin' : 'user', username: user.username ?? null }
}

export function principalIsAdmin(principal: Principal | null): boolean {
  return principal?.role === 'admin'
}

/**
 * A NULL/undefined owner marks system/shared data (for example the Assistant
 * repository), which every authenticated user may access. Administrators may
 * access everything.
 */
export function canAccessOwner(ownerId: string | null | undefined, principal: Principal | null): boolean {
  if (!principal) return false
  if (principal.role === 'admin') return true
  if (ownerId === null || ownerId === undefined) return true
  return ownerId === principal.id
}

export function getRepoOwnerId(db: Database, repoId: number): string | null | undefined {
  const row = db.prepare('SELECT user_id FROM repos WHERE id = ?').get(repoId) as { user_id: string | null } | undefined
  if (!row) return undefined
  return row.user_id
}

export function setRepoOwner(db: Database, repoId: number, ownerId: string | null): void {
  db.prepare('UPDATE repos SET user_id = ? WHERE id = ?').run(ownerId, repoId)
}

export function canAccessRepo(db: Database, repoId: number, principal: Principal | null): boolean {
  if (!principal) return false
  const owner = getRepoOwnerId(db, repoId)
  if (owner === undefined) return false
  if (repoId === ASSISTANT_REPO_ID) return true
  if (principal.role === 'admin') return true
  if (owner === null) return true
  return owner === principal.id
}

export function accessibleRepoIds(db: Database, principal: Principal | null): number[] {
  if (!principal) return []
  if (principal.role === 'admin') {
    const rows = db.prepare('SELECT id FROM repos').all() as { id: number }[]
    return rows.map((row) => row.id)
  }
  const rows = db
    .prepare('SELECT id FROM repos WHERE user_id IS NULL OR user_id = ?')
    .all(principal.id) as { id: number }[]
  return rows.map((row) => row.id)
}

export function ownedRepoPaths(db: Database, principal: Principal): string[] {
  const rows = principal.role === 'admin'
    ? db.prepare('SELECT source_path, local_path FROM repos').all()
    : db.prepare('SELECT source_path, local_path FROM repos WHERE user_id IS NULL OR user_id = ?').all(principal.id)
  return (rows as { source_path: string | null; local_path: string }[])
    .map((row) => row.source_path || path.join(getReposPath(), row.local_path))
}

export function resolveAccessRoots(db: Database, principal: Principal | null): string[] {
  if (!principal) return []
  const workspaceRoot = path.resolve(getWorkspacePath())
  if (principal.role === 'admin') return [workspaceRoot]
  const roots = [path.resolve(getUserWorkspacePath(principal.username ?? principal.id))]
  for (const repoPath of ownedRepoPaths(db, principal)) {
    roots.push(path.resolve(repoPath))
  }
  return Array.from(new Set(roots))
}

export function resolveBrowseRoot(principal: Principal | null): string {
  if (!principal) {
    return process.env.REPO_BROWSE_ROOT ? path.resolve(process.env.REPO_BROWSE_ROOT) : ''
  }
  if (principal.role === 'admin') {
    return process.env.REPO_BROWSE_ROOT ? path.resolve(process.env.REPO_BROWSE_ROOT) : path.resolve(getWorkspacePath())
  }
  return path.resolve(getUserWorkspacePath(principal.username ?? principal.id))
}
