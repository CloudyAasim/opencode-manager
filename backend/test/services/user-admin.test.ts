import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../helpers/assistant-workspace'
import { UserAdminError, UserAdminService } from '../../src/services/user-admin'
import type { AuthInstance } from '../../src/auth'

const { ENV } = vi.hoisted(() => ({
  ENV: {
    AUTH: {
      ADMIN_EMAIL: undefined as string | undefined,
      ADMIN_PASSWORD: undefined as string | undefined,
      ADMIN_PASSWORD_RESET: false,
    },
  },
}))

vi.mock('@opencode-manager/shared/config/env', () => ({ ENV }))

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { hashPasswordMock } = vi.hoisted(() => ({ hashPasswordMock: vi.fn() }))
vi.mock('better-auth/crypto', () => ({ hashPassword: hashPasswordMock }))

function insertUser(db: ReturnType<typeof createTestDb>, id: string, email: string, role = 'user'): void {
  db.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, 'Test User', email, 0, Date.now(), Date.now(), role)
}

function insertCredentialAccount(db: ReturnType<typeof createTestDb>, id: string, userId: string, password: string): void {
  db.prepare(
    'INSERT INTO "account" (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId, 'credential', userId, password, Date.now(), Date.now())
}

function insertSession(db: ReturnType<typeof createTestDb>, id: string, userId: string): void {
  const now = Date.now()
  db.prepare(
    'INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, now + 1000, `token-${id}`, now, now, userId)
}

describe('UserAdminService', () => {
  let db: ReturnType<typeof createTestDb>
  let signUpEmail: ReturnType<typeof vi.fn>
  let service: UserAdminService

  beforeEach(() => {
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

  afterEach(() => {
    db.close()
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

  it('prevents deleting yourself and the last admin', () => {
    insertUser(db, 'admin-1', 'admin@example.com', 'admin')
    insertUser(db, 'user-1', 'user@example.com')

    expect(() => service.deleteUser('admin-1', 'admin-1')).toThrowError(UserAdminError)
    expect(() => service.deleteUser('admin-1')).toThrowError(UserAdminError)
    service.deleteUser('user-1', 'admin-1')
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
