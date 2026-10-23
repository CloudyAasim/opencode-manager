import type { Database } from 'bun:sqlite'
import path from 'node:path'
import { getReposPath, getUserReposPath, getUserSettingPath, getUserWorkspacePath, getWorkspacePath } from '@opencode-manager/shared/config/env'

export interface Principal {
  id: string
  role: 'admin' | 'user'
  username?: string | null
}

/**
 * Everything a principal can be read out of. `Session['user']` satisfies it,
 * and so does the three-field owner an internal request carries, which is why
 * both feed the same function instead of each side growing its own copy of
 * "is this an admin" logic.
 */
export interface PrincipalSource {
  id?: string
  role?: string
  username?: string | null
}

export function principalFrom(user: PrincipalSource | undefined | null): Principal | null {
  if (!user?.id) return null
  return { id: user.id, role: user.role === 'admin' ? 'admin' : 'user', username: user.username ?? null }
}

/**
 * A person, looked up by id. Returns null for an id with no user row, which is
 * a real case: a token outlives the account it was minted for.
 */
export function findUserIdentity(db: Database, userId: string): Principal | null {
  const row = db
    .prepare('SELECT id, role, username FROM "user" WHERE id = ?')
    .get(userId) as PrincipalSource | undefined
  return principalFrom(row)
}

export function principalIsAdmin(principal: Principal | null): boolean {
  return principal?.role === 'admin'
}

/**
 * Whether a person may reach a **shared library** resource owned by `ownerId`.
 *
 * This is the prompt-template rule: the administrator reads every account's
 * copies, because a template is library content rather than somebody's work.
 *
 * Projects are not governed by this. They go through `canAccessRepoOwner`,
 * which does *not* have the administrator shortcut. The two functions used to
 * be written identically, which is exactly how the shortcut ended up governing
 * projects as well - so the difference is now stated here rather than left to
 * be rediscovered.
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

/**
 * Whether a person may reach a project.
 *
 * A project belongs to the account that created it, and that is the whole
 * rule - administrators included. They manage the *server*: accounts, the
 * audit log, the OpenCode process, the terminal, the workspace on disk. A
 * working copy inside somebody else's directory is that person's work, not a
 * server resource.
 *
 * The administrator shortcut that used to answer "yes to everything" is what
 * put every account's projects into the administrator's project switcher. The
 * switcher in the top bar is made of `GET /api/repos`, so "the dropdown lists
 * every user's every project" was this line and nothing else. Two accounts
 * with a checkout of the same name then produced two identical entries, so
 * the list looked less like "the administrator sees too much" and more like
 * "this list is everybody's".
 *
 * The shared rows are the exception and stay shared: `user_id IS NULL` is how
 * the Assistant repository is stored. It is the only thing that should ever
 * land there - a user project that lost its owner would come back into every
 * account's list at once.
 */
export function canAccessRepoOwner(ownerId: string | null | undefined, principal: Principal | null): boolean {
  if (!principal) return false
  if (ownerId === null || ownerId === undefined) return true
  return ownerId === principal.id
}

export function canAccessRepo(db: Database, repoId: number, principal: Principal | null): boolean {
  if (!principal) return false
  const owner = getRepoOwnerId(db, repoId)
  if (owner === undefined) return false
  return canAccessRepoOwner(owner, principal)
}

/**
 * The ids of the projects a person may reach: their own, plus the shared ones.
 *
 * One population for every role. The administrator used to get every row on
 * the server, which made this list - and everything built on it (the internal
 * repo list, the cross-repository schedule list) - a copy of the whole
 * machine.
 */
export function accessibleRepoIds(db: Database, principal: Principal | null): number[] {
  if (!principal) return []
  const rows = db
    .prepare('SELECT id FROM repos WHERE user_id IS NULL OR user_id = ?')
    .all(principal.id) as { id: number }[]
  return rows.map((row) => row.id)
}

/**
 * The on-disk paths of the projects a person may reach.
 *
 * The same population as `accessibleRepoIds`: their own projects, plus the
 * shared ones. The administrator's paths are not in here - an administrator
 * reaches the whole workspace through `resolveAccessRoots`, and that is the
 * server-side reach, not a list of other people's projects.
 */
export function accessibleRepoOwnerPaths(db: Database, principal: Principal): string[] {
  const rows = db
    .prepare('SELECT source_path, local_path FROM repos WHERE user_id IS NULL OR user_id = ?')
    .all(principal.id) as { source_path: string | null; local_path: string }[]
  return rows
    .map((row) => row.source_path || path.join(getReposPath(), row.local_path))
}

/**
 * The roots of the caller's own tenant: their workspace, their settings, and
 * the directories their own projects live in.
 *
 * `resolveAccessRoots` is the *server-wide* reach an administrator has. This
 * is the reach a person's own account has, and the two answer different
 * questions. The project surface asks this one: an administrator's project
 * list is their own, so the directories that may sit next to their projects
 * are theirs too - another account's worktree is not a sibling of theirs, it
 * is another account's worktree.
 */
export function resolveTenantAccessRoots(db: Database, principal: Principal | null): string[] {
  if (!principal) return []
  const username = principal.username ?? principal.id
  const roots = [path.resolve(getUserWorkspacePath(username)), path.resolve(getUserSettingPath(username))]
  for (const repoPath of accessibleRepoOwnerPaths(db, principal)) {
    roots.push(path.resolve(repoPath))
  }
  return Array.from(new Set(roots))
}

/**
 * The roots a request may touch.
 *
 * An administrator gets the whole workspace: they run the server, and the
 * server's files are theirs to manage. Everybody else - administrators
 * included, when the question is about a *project* - is bounded by their own
 * tenant. The two are kept apart on purpose: the project surface uses
 * `resolveTenantAccessRoots`, and the file browser uses this one.
 */
export function resolveAccessRoots(db: Database, principal: Principal | null): string[] {
  if (!principal) return []
  if (principal.role === 'admin') return [path.resolve(getWorkspacePath())]
  return resolveTenantAccessRoots(db, principal)
}

export function resolveBrowseRoot(principal: Principal | null): string {
  if (!principal) return ''
  if (principal.role === 'admin') return path.resolve(getWorkspacePath())
  return path.resolve(getUserWorkspacePath(principal.username ?? principal.id))
}

export function resolveRepoBase(principal: Principal | null): string {
  if (!principal) return path.resolve(getReposPath())
  return path.resolve(getUserReposPath(principal.username ?? principal.id))
}
