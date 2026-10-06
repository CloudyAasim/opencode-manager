import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import type { Database } from 'bun:sqlite'
import { hashPassword } from 'better-auth/crypto'
import { ENV, getUsersWorkspacePath, getUserSettingPath, getUserWorkspacePath } from '@opencode-manager/shared/config/env'
import { deriveUsernameFromEmail, isValidUsername, normalizeUsername, uniquifyUsername } from '@opencode-manager/shared/utils'
import type { AuthInstance } from '../auth'
import { withInternalSignup } from '../auth/internal-signup'
import { safeUserDirectoryName } from './terminal/home'
import { logger } from '../utils/logger'

export type UserRole = 'admin' | 'user'

export interface ManagedUser {
  id: string
  name: string
  email: string
  username: string | null
  role: UserRole
  emailVerified: boolean
  createdAt: number | string
  updatedAt: number | string
}

interface UserRow {
  id: string
  name: string
  email: string
  username: string | null
  role: string | null
  emailVerified: number | boolean
  createdAt: number | string
  updatedAt: number | string
}

export type UserAdminErrorCode =
  | 'EMAIL_EXISTS'
  | 'USERNAME_EXISTS'
  | 'INVALID_USERNAME'
  | 'USER_NOT_FOUND'
  | 'LAST_ADMIN'
  | 'SELF_DELETE'
  | 'NO_CREDENTIAL_ACCOUNT'
  | 'CLEANUP_FAILED'
  | 'INTERNAL'

export class UserAdminError extends Error {
  constructor(public readonly code: UserAdminErrorCode) {
    super(code)
  }
}

const USER_COLUMNS = 'id, name, email, username, role, emailVerified, createdAt, updatedAt'

function toManagedUser(row: UserRow): ManagedUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    username: row.username,
    role: row.role === 'admin' ? 'admin' : 'user',
    emailVerified: Boolean(row.emailVerified),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export class UserAdminService {
  constructor(
    private readonly db: Database,
    private readonly auth: AuthInstance,
  ) {}

  listUsers(): ManagedUser[] {
    const rows = this.db
      .prepare(`SELECT ${USER_COLUMNS} FROM "user" ORDER BY createdAt ASC`)
      .all() as UserRow[]
    return rows.map(toManagedUser)
  }

  getUser(id: string): ManagedUser | null {
    const row = this.db
      .prepare(`SELECT ${USER_COLUMNS} FROM "user" WHERE id = ?`)
      .get(id) as UserRow | undefined
    return row ? toManagedUser(row) : null
  }

  findByEmail(email: string): ManagedUser | null {
    const row = this.db
      .prepare(`SELECT ${USER_COLUMNS} FROM "user" WHERE lower(email) = ?`)
      .get(email.trim().toLowerCase()) as UserRow | undefined
    return row ? toManagedUser(row) : null
  }

  isUsernameTaken(username: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM "user" WHERE lower(username) = ?')
      .get(normalizeUsername(username))
    return Boolean(row)
  }

  private resolveUsername(desired: string | undefined, email: string): string {
    const candidate = desired ? normalizeUsername(desired) : deriveUsernameFromEmail(email)
    if (desired && !isValidUsername(candidate)) {
      throw new UserAdminError('INVALID_USERNAME')
    }
    return uniquifyUsername(candidate, (value) => this.isUsernameTaken(value))
  }

  private async ensureWorkspace(username: string): Promise<void> {
    try {
      await mkdir(getUserWorkspacePath(username), { recursive: true, mode: 0o700 })
      await mkdir(getUserSettingPath(username), { recursive: true, mode: 0o700 })
    } catch (error) {
      logger.warn(`Failed to create the workspace directory for ${username}`, error)
    }
  }

  countUsers(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM "user"').get() as { count: number }
    return row.count
  }

  countAdmins(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) as count FROM "user" WHERE role = 'admin'`)
      .get() as { count: number }
    return row.count
  }

  async createUser(input: { email: string; name: string; password: string; role: UserRole; username?: string }): Promise<ManagedUser> {
    const email = input.email.trim().toLowerCase()
    if (this.findByEmail(email)) {
      throw new UserAdminError('EMAIL_EXISTS')
    }

    const username = this.resolveUsername(input.username, email)

    const result = await withInternalSignup(() =>
      this.auth.api.signUpEmail({
        body: { email, name: input.name.trim(), password: input.password },
      }),
    )

    const userId = result.user.id
    this.db.prepare('UPDATE "user" SET role = ?, username = ? WHERE id = ?').run(input.role, username, userId)
    this.db.prepare('DELETE FROM session WHERE userId = ?').run(userId)
    await this.ensureWorkspace(username)

    const created = this.getUser(userId)
    if (!created) {
      throw new UserAdminError('INTERNAL')
    }
    return created
  }

  setRole(id: string, role: UserRole, actingUserId?: string): ManagedUser {
    const user = this.getUser(id)
    if (!user) throw new UserAdminError('USER_NOT_FOUND')

    if (user.role === 'admin' && role !== 'admin') {
      if (actingUserId && actingUserId === id) {
        throw new UserAdminError('LAST_ADMIN')
      }
      if (this.countAdmins() <= 1) {
        throw new UserAdminError('LAST_ADMIN')
      }
    }

    this.db.prepare('UPDATE "user" SET role = ? WHERE id = ?').run(role, id)
    const updated = this.getUser(id)
    if (!updated) throw new UserAdminError('USER_NOT_FOUND')
    return updated
  }

  async setPassword(id: string, password: string): Promise<void> {
    const user = this.getUser(id)
    if (!user) throw new UserAdminError('USER_NOT_FOUND')

    const account = this.db
      .prepare(`SELECT id FROM account WHERE userId = ? AND providerId = 'credential'`)
      .get(id) as { id: string } | undefined
    if (!account) {
      throw new UserAdminError('NO_CREDENTIAL_ACCOUNT')
    }

    const hashedPassword = await hashPassword(password)
    this.db
      .prepare(`UPDATE account SET password = ?, updatedAt = ? WHERE id = ?`)
      .run(hashedPassword, Date.now(), account.id)
    this.db.prepare('DELETE FROM session WHERE userId = ?').run(id)
  }

  /**
 * Every directory this person may own under `users/`, and nothing else.
 *
 * There is more than one name, which is the reason this is a function and not an
 * inline `path.join`. A user with a username owns `users/<username>/`. A user
 * whose username does not match the terminal's pattern owns
 * `users/<safeUserDirectoryName(id)>/` instead - `resolveUserTerminalHome`
 * picks between them, and which one it picked is not recorded anywhere, so
 * deleting has to consider both. And `resolveAccessRoots`, `resolveBrowseRoot`
 * and `resolveRepoBase` all fall back to `username ?? id`, so a user row with no
 * username at all can own `users/<id>/`.
 *
 * The id fallback is the one that cannot be taken on trust: a username matches
 * `/^[a-z][a-z0-9]{2,31}$/` and a generated id may not, so `users/<id>/` could
 * in principle be another person's username directory. It is therefore skipped
 * whenever some other row already claims that name.
 *
 * Every candidate is checked against `users/` before it is returned. These
 * strings reach `rm -rf`, and `path.join` is not a containment check -
 * `../../elsewhere` and an absolute path both survive it.
 */
private userDirectories(user: ManagedUser): string[] {
  const usersRoot = path.resolve(getUsersWorkspacePath())

  const names: string[] = []
  if (user.username) names.push(user.username)
  names.push(safeUserDirectoryName(user.id))
  if (!user.username && !this.isUsernameTaken(user.id)) names.push(user.id)

  const directories: string[] = []
  const seen = new Set<string>()
  for (const name of names) {
    if (!name || seen.has(name)) continue
    seen.add(name)
    const target = path.resolve(usersRoot, name)
    const relative = path.relative(usersRoot, target)
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      logger.error(
        `Refusing to remove ${target} while deleting user ${user.id}: it is not inside ${usersRoot}`,
      )
      continue
    }
    directories.push(target)
  }
  return directories
}

/**
 * Deleting the account is only half of it. Everything this person owns on disk
 * goes with it, and the order is the point:
 *
 * 1. validation, so a refused delete has caused no side effect at all
 * 2. `beforeCleanup`, so live shells are closed before the directory they are
 *    sitting in disappears - a process whose cwd has been unlinked keeps
 *    running in an inode nothing can reach
 * 3. the directories
 * 4. the rows
 *
 * A failure in step 3 raises `CLEANUP_FAILED` and the rows are left alone. The
 * other order would delete the account and strand a directory nothing in the
 * application can name any more, which is exactly the state this exists to
 * remove; a directory that survived is something an admin can retry, and
 * retrying converges because the missing half is a no-op.
 */
async deleteUser(id: string, actingUserId?: string, beforeCleanup?: (userId: string) => void): Promise<void> {
  const user = this.getUser(id)
  if (!user) throw new UserAdminError('USER_NOT_FOUND')
  if (actingUserId && actingUserId === id) {
    throw new UserAdminError('SELF_DELETE')
  }
  if (user.role === 'admin' && this.countAdmins() <= 1) {
    throw new UserAdminError('LAST_ADMIN')
  }

  beforeCleanup?.(id)

  for (const directory of this.userDirectories(user)) {
    try {
      await rm(directory, { recursive: true, force: true })
    } catch (error) {
      logger.error(
        `Failed to remove ${directory} while deleting user ${id}; the account has been left in place`,
        error,
      )
      throw new UserAdminError('CLEANUP_FAILED')
    }
  }

  this.db.prepare('DELETE FROM repos WHERE user_id = ?').run(id)
  this.db.prepare('DELETE FROM "user" WHERE id = ?').run(id)
}

  async ensureAdminFromEnv(): Promise<void> {
    const email = ENV.AUTH.ADMIN_EMAIL?.trim().toLowerCase()
    const password = ENV.AUTH.ADMIN_PASSWORD
    if (!email || !password) return

    const existing = this.findByEmail(email)
    if (existing) {
      if (!existing.username) {
        try {
          const username = this.resolveUsername(undefined, email)
          this.db.prepare('UPDATE "user" SET username = ? WHERE id = ?').run(username, existing.id)
          await this.ensureWorkspace(username)
        } catch (error) {
          logger.error('Failed to assign a username to the environment admin', error)
        }
      }
      if (ENV.AUTH.ADMIN_PASSWORD_RESET) {
        try {
          await this.setPassword(existing.id, password)
          logger.info(`Admin password reset from environment for ${email}`)
          logger.warn('Remove ADMIN_PASSWORD_RESET=true from environment after password reset')
        } catch (error) {
          logger.error('Failed to reset admin password from environment', error)
        }
      }
      if (existing.role !== 'admin') {
        this.setRole(existing.id, 'admin')
        logger.info(`Promoted ${email} to admin from environment`)
      }
      return
    }

    try {
      await this.createUser({ email, name: 'Admin', password, role: 'admin' })
      logger.info(`Admin user created from environment: ${email}`)
    } catch (error) {
      logger.error('Failed to create admin user from environment', error)
    }
  }
}
