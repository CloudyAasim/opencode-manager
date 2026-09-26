import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createAdminUserRoutes } from '../../src/routes/admin-users'
import { UserAdminError, type UserAdminService } from '../../src/services/user-admin'
import type { Session } from '../../src/auth'
import { createSessionUser } from '../helpers/session-user'

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

function createApp(service: Partial<UserAdminService>, role: 'admin' | 'user') {
  const root = new Hono<{ Variables: { user: Session['user']; session: Session['session'] } }>()
  root.use('/*', async (c, next) => {
    c.set('user', createSessionUser(role))
    c.set('session', { id: 'session-1' } as Session['session'])
    await next()
  })
  root.route('/', createAdminUserRoutes(service as unknown as UserAdminService) as unknown as Hono)
  return root
}

describe('admin user routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects non-admins with 403', async () => {
    const app = createApp({ listUsers: vi.fn(() => []) }, 'user')

    const res = await app.request('/')

    expect(res.status).toBe(403)
  })

  it('lists users for administrators', async () => {
    const users = [{
      id: '1',
      name: 'A',
      email: 'a@example.com',
      username: null,
      role: 'admin' as const,
      emailVerified: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }]
    const listUsers = vi.fn(() => users)
    const app = createApp({ listUsers }, 'admin')

    const res = await app.request('/')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ users })
    expect(listUsers).toHaveBeenCalled()
  })

  it('validates the create payload', async () => {
    const createUser = vi.fn()
    const app = createApp({ createUser }, 'admin')

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', name: '', password: 'short' }),
    })

    expect(res.status).toBe(400)
    expect(createUser).not.toHaveBeenCalled()
  })

  it('maps service errors to HTTP status codes', async () => {
    const createUser = vi.fn(async () => {
      throw new UserAdminError('EMAIL_EXISTS')
    })
    const app = createApp({ createUser }, 'admin')

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', name: 'A', password: 'password123', role: 'user' }),
    })

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'EMAIL_EXISTS' })
  })

  it('forwards the acting user id when deleting', async () => {
    const deleteUser = vi.fn()
    const app = createApp({ deleteUser }, 'admin')

    const res = await app.request('/user-2', { method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(deleteUser).toHaveBeenCalledWith('user-2', 'me')
  })
})
