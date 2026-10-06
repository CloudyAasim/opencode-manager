import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createTestDb } from '../helpers/assistant-workspace'
import { UserAdminError, UserAdminService } from '../../src/services/user-admin'
import { safeUserDirectoryName } from '../../src/services/terminal/home'
import type { AuthInstance } from '../../src/auth'

const { ENV, state } = vi.hoisted(() => ({
  ENV: {
    AUTH: {
      ADMIN_EMAIL: undefined as string | undefined,
      ADMIN_PASSWORD: undefined as string | undefined,
      ADMIN_PASSWORD_RESET: false,
    },
  },
  state: { workspace: '', failRemovalUnder: null as string | null },
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  ENV,
  getUsersWorkspacePath: () => path.join(state.workspace, 'users'),
  getUserWorkspacePath: (username: string) => path.join(state.workspace, 'users', username, 'workspace'),
  getUserSettingPath: (username: string) => path.join(state.workspace, 'users', username, 'setting'),
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rm: (target: string, options?: { recursive?: boolean; force?: boolean }) => {
      if (state.failRemovalUnder && String(target).includes(state.failRemovalUnder)) {
        return Promise.reject(Object.assign(new Error('permission denied'), { code: 'EACCES' }))
      }
      return actual.rm(target, options)
    },
  }
})

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { hashPasswordMock } = vi.hoisted(() => ({ hashPasswordMock: vi.fn() }))
vi.mock('better-auth/crypto', () => ({ hashPassword: hashPasswordMock }))

function insertUser(
  db: ReturnType<typeof createTestDb>,
  id: string,
  email: string,
  role = 'user',
  username: string | null = null,
): void {
  db.prepare(
    'INSERT INTO "user" (id, name, email, username, emailVerified, createdAt, updatedAt, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, 'Test User', email, username, 0, Date.now(), Date.now(), role)
}

function insertCredentialAccount(db: ReturnType<typeof createTestDb>, id: string, userId: string, password: string): void {
  db.prepare(
    'INSERT INTO "account" (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, userId, 'credential', userId, password, Date.now(), Date.now())
}

function insertSession(db: ReturnType<typeof createTestDb>, id: string, userId: string): void {
  const now = Date.now()
  db.prepare(
    'INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, now + 1000, `token-${id}`, now, now, userId)
}

function insertRepo(
  db: ReturnType<typeof createTestDb>,
  id: number,
  localPath: string,
  userId: string | null,
): void {
  db.prepare(
    `INSERT INTO repos (id, repo_url, local_path, branch, default_branch, clone_status, cloned_at)
     VALUES (?, ?, ?, ?, ?, 'ready', ?)`,
  ).run(id, `https://example.invalid/${localPath}.git`, localPath, 'main', 'main', Date.now())
  db.prepare('UPDATE repos SET user_id = ? WHERE id = ?').run(userId, id)
}

function userDir(...segments: string[]): string {
  return path.join(state.workspace, 'users', ...segments)
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target)
    return true
  } catch {
    return false
  }
}

async function writeUnder(target: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, contents)
}

describe('UserAdminService', () => {
  let db: ReturnType<typeof createTestDb>
  let signUpEmail: ReturnType<typeof vi.fn>
  let service: UserAdminService

  beforeEach(async () => {
    state.workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ocm-user-admin-'))
    state.failRemovalUnder = null
    db = createTestDb()
    vi.clearAllMocks()
    hashPasswordMock.mockImplementation(async (password: string) => `hashed:${password}`)
    signUpEmail = vi.fn(async ({ body }: { body: { email: string; name: string } }) => {
      const id = `user-${body.email}`
      insertUser(db, id, body.email)
      insertSession(db, `session-${id}`, id)
      return { user: { id }, token: 'token' }
    })
    service = new UserAdminService(db, { api: { signUpEmail } } as unknown as AuthInstance)
  })

  afterEach(async () => {
    db.close()
    await fs.rm(state.workspace, { recursive: true, force: true })
  })

  it('creates a user and assigns the requested role without leaving a session behind', async () => {
    const created = await service.createUser({
      email: 'Admin@Example.com',
      name: 'Admin',
      password: 'password123',
      role: 'admin',
    })

    expect(signUpEmail).toHaveBeenCalledWith({
      body: { email: 'admin@example.com', name: 'Admin', password: 'password123' },
    })
    expect(created.role).toBe('admin')
    const sessions = db.prepare('SELECT COUNT(*) as count FROM "session" WHERE userId = ?').get(created.id) as { count: number }
    expect(sessions.count).toBe(0)
  })

  it('rejects creating a user with a duplicate email', async () => {
    insertUser(db, 'user-1', 'dup@example.com')

    await expect(
      service.createUser({ email: 'dup@example.com', name: 'Dup', password: 'password123', role: 'user' }),
    ).rejects.toMatchObject({ code: 'EMAIL_EXISTS' })
    expect(signUpEmail).not.toHaveBeenCalled()
  })

  it('promotes and demotes users while protecting the last admin', () => {
    insertUser(db, 'admin-1', 'admin@example.com', 'admin')
    insertUser(db, 'user-1', 'user@example.com')

    expect(service.setRole('user-1', 'admin').role).toBe('admin')
    expect(service.countAdmins()).toBe(2)
    expect(service.setRole('admin-1', 'user').role).toBe('user')
    expect(service.countAdmins()).toBe(1)
    expect(() => service.setRole('user-1', 'user')).toThrowError(UserAdminError)
    expect(service.countAdmins()).toBe(1)
  })

  it('resets the credential password and revokes existing sessions', async () => {
    insertUser(db, 'user-1', 'user@example.com')
    insertCredentialAccount(db, 'account-1', 'user-1', 'old-hash')
    insertSession(db, 'session-1', 'user-1')

    await service.setPassword('user-1', 'new-password')

    const account = db.prepare('SELECT password FROM "account" WHERE userId = ?').get('user-1') as { password: string }
    expect(account.password).toBe('hashed:new-password')
    const sessions = db.prepare('SELECT COUNT(*) as count FROM "session" WHERE userId = ?').get('user-1') as { count: number }
    expect(sessions.count).toBe(0)
  })

  it('refuses to reset a password for a user without a credential account', async () => {
    insertUser(db, 'user-1', 'oauth@example.com')

    await expect(service.setPassword('user-1', 'new-password')).rejects.toMatchObject({
      code: 'NO_CREDENTIAL_ACCOUNT',
    })
  })

  it('prevents deleting yourself and the last admin', async () => {
    insertUser(db, 'admin-1', 'admin@example.com', 'admin')
    insertUser(db, 'user-1', 'user@example.com')
    const onWillDelete = vi.fn()

    await expect(service.deleteUser('admin-1', 'admin-1', onWillDelete)).rejects.toMatchObject({ code: 'SELF_DELETE' })
    await expect(service.deleteUser('admin-1', undefined, onWillDelete)).rejects.toMatchObject({ code: 'LAST_ADMIN' })
    expect(onWillDelete).not.toHaveBeenCalled()

    await service.deleteUser('user-1', 'admin-1', onWillDelete)
    expect(service.countUsers()).toBe(1)
  })

  it('counts users and admins', () => {
    insertUser(db, 'admin-1', 'a@example.com', 'admin')
    insertUser(db, 'user-1', 'b@example.com')

    expect(service.countUsers()).toBe(2)
    expect(service.countAdmins()).toBe(1)
    expect(service.listUsers()).toHaveLength(2)
  })
})

describe('deleting a user removes what they owned on disk', () => {
  let db: ReturnType<typeof createTestDb>
  let service: UserAdminService

  beforeEach(async () => {
    state.workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ocm-user-admin-'))
    state.failRemovalUnder = null
    db = createTestDb()
    vi.clearAllMocks()
    service = new UserAdminService(db, { api: {} } as unknown as AuthInstance)
  })

  afterEach(async () => {
    db.close()
    await fs.rm(state.workspace, { recursive: true, force: true })
  })

  it('takes the workspace and the settings directory with the account', async () => {
    insertUser(db, 'user-1', 'alice@example.com', 'user', 'alice')
    await writeUnder(userDir('alice', 'setting', 'opencode.json'), '{"provider":{}}')
    await writeUnder(userDir('alice', 'workspace', 'repos', 'relay-ab', 'README.md'), 'hello')
    await writeUnder(userDir('bob', 'workspace', 'keep.txt'), 'keep me')

    await service.deleteUser('user-1')

    expect(await exists(userDir('alice'))).toBe(false)
    expect(await exists(userDir('bob', 'workspace', 'keep.txt'))).toBe(true)
    expect(service.getUser('user-1')).toBeNull()
  })

  it('takes the terminal home that is keyed by user id, not by username', async () => {
    insertUser(db, 'user-1', 'alice@example.com', 'user', 'alice')
    const terminalHome = safeUserDirectoryName('user-1')
    await writeUnder(userDir(terminalHome, '.bashrc'), 'export PS1="$ "\n')

    await service.deleteUser('user-1')

    expect(await exists(userDir(terminalHome))).toBe(false)
  })

  it('takes the id-named directory a user without a username owns', async () => {
    insertUser(db, 'user-1', 'alice@example.com', 'user', null)
    await writeUnder(userDir('user-1', 'workspace', 'repos', 'thing', 'a.txt'), 'a')

    await service.deleteUser('user-1')

    expect(await exists(userDir('user-1'))).toBe(false)
  })

  it("will not take a directory whose name is another person's username", async () => {
    // The collision that matters: the account being deleted has no username, so
    // the id fallback reaches for `users/<id>`, and here that id spells out the
    // other person's username. Only the `isUsernameTaken` check stands between
    // this delete and somebody else's workspace.
    insertUser(db, 'alice', 'alice@example.com', 'user', null)
    insertUser(db, 'user-b', 'bob@example.com', 'user', 'alice')
    await writeUnder(userDir('alice', 'workspace', 'keep.txt'), 'keep me')
    const terminalHome = safeUserDirectoryName('alice')
    await writeUnder(userDir(terminalHome, 'gone.txt'), 'bye')

    await service.deleteUser('alice')

    expect(await exists(userDir('alice', 'workspace', 'keep.txt'))).toBe(true)
    expect(await exists(userDir(terminalHome))).toBe(false)
    expect(service.getUser('user-b')).not.toBeNull()
  })

  it('refuses a name that would reach outside the users directory', async () => {
    insertUser(db, 'user-1', 'alice@example.com', 'user', '../escaped')
    const escaped = path.join(state.workspace, 'users', '..', 'escaped')
    await writeUnder(escaped, 'must survive')

    await service.deleteUser('user-1')

    expect(await exists(escaped)).toBe(true)
    expect(service.getUser('user-1')).toBeNull()
  })

  it('closes the running shells before the directory under them is removed', async () => {
    insertUser(db, 'user-1', 'alice@example.com', 'user', 'alice')
    await writeUnder(userDir('alice', 'workspace', 'repos', 'relay-ab', 'README.md'), 'hello')

    let existedWhenTheHookRan = false
    await service.deleteUser('user-1', 'admin-1', async (userId) => {
      expect(userId).toBe('user-1')
      existedWhenTheHookRan = await exists(userDir('alice'))
    })

    expect(existedWhenTheHookRan).toBe(true)
    expect(await exists(userDir('alice'))).toBe(false)
  })

  it('leaves the account in place when a directory cannot be removed', async () => {
    insertUser(db, 'user-1', 'alice@example.com', 'user', 'alice')
    await writeUnder(userDir('alice', 'setting', 'opencode.json'), '{}')
    state.failRemovalUnder = 'alice'

    await expect(service.deleteUser('user-1')).rejects.toMatchObject({ code: 'CLEANUP_FAILED' })

    expect(service.getUser('user-1')).not.toBeNull()
    expect(await exists(userDir('alice', 'setting', 'opencode.json'))).toBe(true)
  })

  it('takes the repository rows the user owned and leaves the shared ones', async () => {
    insertUser(db, 'user-1', 'alice@example.com', 'user', 'alice')
    insertRepo(db, 1, 'relay-ab', 'user-1')
    insertRepo(db, 2, 'shared-thing', null)
    insertRepo(db, 3, 'other-users-thing', 'someone-else')

    await service.deleteUser('user-1')

    const remaining = (db.prepare('SELECT local_path FROM repos ORDER BY id').all() as { local_path: string }[])
      .map((row) => row.local_path)
    expect(remaining).toEqual(['shared-thing', 'other-users-thing'])
  })
})