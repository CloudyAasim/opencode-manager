import type { Database } from 'bun:sqlite'
import type { Session } from './index'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'

export interface Principal {
  id: string
  role: 'admin' | 'user'
}

export function principalFrom(user: Session['user'] | undefined | null): Principal | null {
  if (!user?.id) return null
  return { id: user.id, role: user.role === 'admin' ? 'admin' : 'user' }
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
