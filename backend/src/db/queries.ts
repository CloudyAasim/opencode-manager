import type { Database } from 'bun:sqlite'
import type { Repo, CreateRepoInput } from '../types/repo'
import { getReposPath } from '@opencode-manager/shared/config/env'
import { ASSISTANT_REPO_ID, ASSISTANT_REPO_PATH, getRepoDisplayName } from '@opencode-manager/shared/utils'
import { RepositoryNotFoundError, ServiceUnavailableError } from '../utils/errors'
import { getErrorMessage } from '../utils/error-utils'
import path from 'path'

interface RepoRow {
  id: number
  name?: string
  repo_url?: string
  local_path: string
  source_path?: string
  branch?: string
  default_branch: string
  clone_status: string
  cloned_at: number
  last_pulled?: number
  last_accessed_at?: number
  user_id?: string | null
  is_worktree?: number
  is_local?: number
}

const REPO_GIT_CREDENTIAL_SETTING_KEY = 'gitCredentialId'

function rowToRepo(row: RepoRow): Repo {
  const fullPath = row.source_path || path.join(getReposPath(), row.local_path)

  return {
    id: row.id,
    name: row.name ?? undefined,
    repoUrl: row.repo_url,
    localPath: row.local_path,
    fullPath,
    sourcePath: row.source_path,
    branch: row.branch,
    defaultBranch: row.default_branch,
    cloneStatus: row.clone_status as Repo['cloneStatus'],
    clonedAt: row.cloned_at,
    lastPulled: row.last_pulled,
    lastAccessedAt: row.last_accessed_at,
    userId: row.user_id ?? null,
    isWorktree: row.is_worktree ? Boolean(row.is_worktree) : undefined,
    isLocal: row.is_local ? Boolean(row.is_local) : undefined,
  }
}

export function getRepoSetting(db: Database, repoId: number, key: string): string | null {
  const row = db
    .prepare('SELECT value FROM repo_settings WHERE repo_id = ? AND key = ?')
    .get(repoId, key) as { value: string } | undefined

  return row?.value ?? null
}

export function setRepoSetting(db: Database, repoId: number, key: string, value: string | null): void {
  const now = Date.now()
  const updateSetting = db.transaction(() => {
    if (value === null || value === '') {
      db.prepare('DELETE FROM repo_settings WHERE repo_id = ? AND key = ?').run(repoId, key)
      return
    }

    db.prepare(`
      INSERT INTO repo_settings (repo_id, key, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(repo_id, key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(repoId, key, value, now)
  })

  updateSetting()
}

export function getRepoGitCredentialId(db: Database, repoId: number): string | null {
  return getRepoSetting(db, repoId, REPO_GIT_CREDENTIAL_SETTING_KEY)
}

export function setRepoGitCredentialId(db: Database, repoId: number, credentialId: string | null): void {
  setRepoSetting(db, repoId, REPO_GIT_CREDENTIAL_SETTING_KEY, credentialId)
}

export function getRepoByDirectory(db: Database, directory: string): Repo | null {
  const resolvedDirectory = path.resolve(directory)
  const repos = listRepos(db)

  return repos
    .filter((repo) => {
      const resolvedRepoPath = path.resolve(repo.fullPath)
      const relativePath = path.relative(resolvedRepoPath, resolvedDirectory)
      return relativePath === '' || (!!relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath))
    })
    .sort((a, b) => b.fullPath.length - a.fullPath.length)[0] ?? null
}

const TABLES_WITH_REPO_ID = ['schedule_jobs', 'schedule_runs', 'repo_settings'] as const
type RepoIdTable = typeof TABLES_WITH_REPO_ID[number]

function updateRepoIdReference(db: Database, tableName: RepoIdTable, fromRepoId: number, toRepoId: number): void {
  db.prepare(`UPDATE ${tableName} SET repo_id = ? WHERE repo_id = ?`).run(toRepoId, fromRepoId)
}

export function getRepoById(db: Database, id: number): Repo | null {
  const stmt = db.prepare('SELECT * FROM repos WHERE id = ?')
  const row = stmt.get(id) as RepoRow | undefined
  
  return row ? rowToRepo(row) : null
}

export function ensureAssistantRepo(db: Database): Repo {
  const now = Date.now()

  const syncAssistantRepo = db.transaction(() => {
    const existingAssistantPathRow = db.prepare('SELECT id FROM repos WHERE local_path = ? AND id != ?')
      .get(ASSISTANT_REPO_PATH, ASSISTANT_REPO_ID) as { id: number } | undefined

    if (existingAssistantPathRow) {
      for (const table of TABLES_WITH_REPO_ID) {
        updateRepoIdReference(db, table, existingAssistantPathRow.id, ASSISTANT_REPO_ID)
      }
      db.prepare('DELETE FROM repos WHERE id = ?').run(existingAssistantPathRow.id)
    }

    db.prepare(`
      INSERT INTO repos (
        id,
        repo_url,
        local_path,
        source_path,
        branch,
        default_branch,
        clone_status,
        cloned_at,
        last_accessed_at,
        is_worktree,
        is_local
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        repo_url = excluded.repo_url,
        local_path = excluded.local_path,
        source_path = excluded.source_path,
        branch = excluded.branch,
        default_branch = excluded.default_branch,
        clone_status = excluded.clone_status,
        last_accessed_at = excluded.last_accessed_at,
        is_worktree = excluded.is_worktree,
        is_local = excluded.is_local
    `).run(
      ASSISTANT_REPO_ID,
      null,
      ASSISTANT_REPO_PATH,
      null,
      null,
      'main',
      'ready',
      now,
      now,
      0,
      0,
    )
  })

  syncAssistantRepo()

  const repo = getRepoById(db, ASSISTANT_REPO_ID)
  if (!repo) {
    throw new ServiceUnavailableError('Failed to sync Assistant repository')
  }

  return repo
}

export function createRepo(db: Database, repo: CreateRepoInput): Repo {
  const normalizedPath = repo.localPath.trim().replace(/\/+$/, '')
  
  // Scoped to the owner being written, not to the table. Without this a second
  // user cloning a URL somebody else already has is handed that user's row -
  // which the web route then turns into a 403, so the failure is a confusing
  // message rather than a leak, but `cloneRepo` has still passed someone
  // else's object to its caller.
  const scope = ownedBy(repo.userId)
  const existing = repo.isLocal
    ? repo.sourcePath
      ? getRepoBySourcePath(db, repo.sourcePath, scope) ?? getRepoByLocalPath(db, normalizedPath, scope)
      : getRepoByLocalPath(db, normalizedPath, scope)
    : getRepoByUrlAndBranch(db, repo.repoUrl, repo.branch, scope)

  if (existing) {
    return existing
  }
  
  const stmt = db.prepare(`
    INSERT INTO repos (repo_url, local_path, source_path, branch, default_branch, clone_status, cloned_at, last_accessed_at, is_worktree, is_local, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  
  try {
    const result = stmt.run(
      repo.repoUrl || null,
      normalizedPath,
      repo.sourcePath || null,
      repo.branch || null,
      repo.defaultBranch,
      repo.cloneStatus,
      repo.clonedAt,
      repo.clonedAt,
      repo.isWorktree ? 1 : 0,
      repo.isLocal ? 1 : 0,
      repo.userId ?? null
    )
    
    const newRepo = getRepoById(db, Number(result.lastInsertRowid))
    if (!newRepo) {
      throw new ServiceUnavailableError(`Failed to retrieve newly created repo with id ${result.lastInsertRowid}`)
    }
    return newRepo
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error)
    if (errorMessage.includes('UNIQUE constraint failed') || (error && typeof error === 'object' && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE')) {
      // Same scope as the lookup above. Recovering with an unscoped query here
      // is how a *different* user's row got returned as though it were the
      // conflict being recovered from.
      const conflictRepo = repo.isLocal
        ? repo.sourcePath
          ? getRepoBySourcePath(db, repo.sourcePath, scope) ?? getRepoByLocalPath(db, normalizedPath, scope)
          : getRepoByLocalPath(db, normalizedPath, scope)
        : getRepoByUrlAndBranch(db, repo.repoUrl, repo.branch, scope)

      if (conflictRepo) {
        return conflictRepo
      }

      // Name the constraint that actually fired. The old message always blamed
      // the URL and then suggested database corruption, so a perfectly ordinary
      // "this directory name is taken" was reported as a mystery - and the
      // real cause, a name that is unique per user colliding across users,
      // was invisible.
      //
      // Every column of the violated index is listed, so this cannot read off
      // the first one: `idx_local_path` reports `repos.user_id, repos.local_path`,
      // and the first is the user's own identity - the one thing they cannot
      // choose differently. `local_path` is the actionable half.
      const columns = [...errorMessage.matchAll(/UNIQUE constraint failed: (.+)$/g)]
        .flatMap((match) => (match[1] ?? '').split(','))
        .map((name) => name.trim().split('.').pop() ?? '')
        .filter(Boolean)
      const detail = columns.includes('local_path')
        ? `The directory name '${normalizedPath}' is already used by another repository. `
          + 'Each user gets their own repositories directory, so this name has to be unique within one user; '
          + 'pass a different directoryName.'
        : columns.length > 0
          ? `The value for ${columns.join(', ')} is already used by another repository. `
          : 'A uniqueness constraint was violated. '

      throw new ServiceUnavailableError(
        `Cannot create repository: ${detail}` +
        (repo.isLocal
          ? `(local_path '${normalizedPath}')`
          : `(repo_url '${repo.repoUrl}'${repo.branch ? ` branch '${repo.branch}'` : ''})`),
      )
    }
    
    throw new ServiceUnavailableError(`Failed to create repository: ${errorMessage}`)
  }
}

/**
 * Which rows a lookup is allowed to match.
 *
 * `owner` is what every write path means: one user's own row, plus the shared
 * ones when the owner is null. `any` exists for the caller that is not acting
 * for a user at all - a system job handed an absolute directory and trying to
 * *name* the row it belongs to, which then only decides which subscriptions
 * get told something happened.
 *
 * Required rather than defaulted, and that is the whole point: an optional
 * `userId?` makes the cross-tenant call the one nobody remembers to pass.
 * Every call site states which population it means, so the list is a grep.
 */
export type RepoOwnerScope =
  | { kind: 'owner'; userId: string | null }
  | { kind: 'any' }

/** A user-scoped lookup. `null` means shared rows, which is what they always were. */
export function ownedBy(userId: string | null | undefined): RepoOwnerScope {
  return { kind: 'owner', userId: userId ?? null }
}

/** A system lookup. Grep for this: each use should be justifiable in one line. */
export function anyOwner(): RepoOwnerScope {
  return { kind: 'any' }
}

/**
 * The owner predicate, or nothing for an unscoped lookup.
 *
 * `IS` rather than `= NULL`, because that is the NULL-safe form in SQLite, and
 * writing it once beats each call site remembering which form works on a
 * nullable column.
 */
function ownerPredicate(scope: RepoOwnerScope): string {
  return scope.kind === 'owner' ? ' AND user_id IS ?' : ''
}

function ownerParam(scope: RepoOwnerScope): (string | null)[] {
  return scope.kind === 'owner' ? [scope.userId] : []
}

export function getRepoByUrlAndBranch(
  db: Database,
  repoUrl: string,
  branch: string | undefined,
  scope: RepoOwnerScope,
): Repo | null {
  const branchClause = branch ? 'branch = ?' : 'branch IS NULL'
  // Ordered so an unscoped match is reproducible. With per-user directory
  // names, an unscoped lookup can match more than one row, and "whichever the
  // query planner reached first" is not something a test can assert about.
  const stmt = db.prepare(
    `SELECT * FROM repos WHERE repo_url = ? AND ${branchClause}${ownerPredicate(scope)} ORDER BY id LIMIT 1`,
  )
  const row = stmt.get(
    repoUrl,
    ...(branch ? [branch] : []),
    ...ownerParam(scope),
  ) as RepoRow | undefined

  return row ? rowToRepo(row) : null
}

export function getRepoByLocalPath(
  db: Database,
  localPath: string,
  scope: RepoOwnerScope,
): Repo | null {
  const stmt = db.prepare(
    `SELECT * FROM repos WHERE local_path = ?${ownerPredicate(scope)} ORDER BY id LIMIT 1`,
  )
  const row = stmt.get(localPath, ...ownerParam(scope)) as RepoRow | undefined

  return row ? rowToRepo(row) : null
}

export function getRepoBySourcePath(
  db: Database,
  sourcePath: string,
  scope: RepoOwnerScope,
): Repo | null {
  const stmt = db.prepare(
    `SELECT * FROM repos WHERE source_path = ?${ownerPredicate(scope)} ORDER BY id LIMIT 1`,
  )
  const row = stmt.get(sourcePath, ...ownerParam(scope)) as RepoRow | undefined

  return row ? rowToRepo(row) : null
}

export function listRepos(db: Database, repoOrder?: number[]): Repo[] {
  const stmt = db.prepare('SELECT * FROM repos ORDER BY cloned_at DESC')
  const rows = stmt.all() as RepoRow[]
  const repos = rows.map(rowToRepo)

  if (!repoOrder || repoOrder.length === 0) {
    return repos
  }

  const orderMap = new Map(repoOrder.map((id, index) => [id, index]))
  const orderedRepos = repos
    .filter((repo) => orderMap.has(repo.id))
    .sort((a, b) => {
      const indexA = orderMap.get(a.id)!
      const indexB = orderMap.get(b.id)!
      return indexA - indexB
    })

  const remainingRepos = repos
    .filter((repo) => !orderMap.has(repo.id))
    .sort((a, b) => {
      const nameA = getRepoName(a).toLowerCase()
      const nameB = getRepoName(b).toLowerCase()
      return nameA.localeCompare(nameB)
    })

  return [...orderedRepos, ...remainingRepos]
}

export function getRepoName(repo: Repo): string {
  return getRepoDisplayName(repo)
}

export function updateRepoStatus(db: Database, id: number, cloneStatus: Repo['cloneStatus']): void {
  const stmt = db.prepare('UPDATE repos SET clone_status = ? WHERE id = ?')
  const result = stmt.run(cloneStatus, id)
  if (result.changes === 0) {
    throw new RepositoryNotFoundError(id)
  }
}

export function updateLastPulled(db: Database, id: number): void {
  const stmt = db.prepare('UPDATE repos SET last_pulled = ? WHERE id = ?')
  const result = stmt.run(Date.now(), id)
  if (result.changes === 0) {
    throw new RepositoryNotFoundError(id)
  }
}

export function updateLastAccessed(db: Database, id: number): void {
  const stmt = db.prepare('UPDATE repos SET last_accessed_at = ? WHERE id = ?')
  const result = stmt.run(Date.now(), id)
  if (result.changes === 0) {
    throw new RepositoryNotFoundError(id)
  }
}

export function updateRepoBranch(db: Database, id: number, branch: string): void {
  const stmt = db.prepare('UPDATE repos SET branch = ? WHERE id = ?')
  const result = stmt.run(branch, id)
  if (result.changes === 0) {
    throw new RepositoryNotFoundError(id)
  }
}

export function updateRepoName(db: Database, id: number, name: string | null): void {
  const stmt = db.prepare('UPDATE repos SET name = ? WHERE id = ?')
  const result = stmt.run(name, id)
  if (result.changes === 0) {
    throw new RepositoryNotFoundError(id)
  }
}

export function deleteRepo(db: Database, id: number): void {
  if (id === ASSISTANT_REPO_ID) {
    return
  }

  for (const table of TABLES_WITH_REPO_ID) {
    db.prepare(`DELETE FROM ${table} WHERE repo_id = ?`).run(id)
  }
  const stmt = db.prepare('DELETE FROM repos WHERE id = ?')
  stmt.run(id)
}
