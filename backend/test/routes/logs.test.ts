import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createLogRoutes } from '../../src/routes/logs'
import { resetManagerLogBuffer, appendManagerLogEntry } from '../../src/utils/log-buffer'

type User = { id: string; email: string; role?: string }

function appAs(user: User | null) {
  const app = new Hono<{ Variables: { user: User } }>()
  app.use('*', async (c, next) => {
    if (user) c.set('user', user as never)
    await next()
  })
  app.route('/logs', createLogRoutes())
  return app
}

const ADMIN: User = { id: 'admin-1', email: 'admin@example.com', role: 'admin' }
const MEMBER: User = { id: 'user-2', email: 'member@example.com', role: 'user' }

beforeEach(() => {
  resetManagerLogBuffer()
})

describe('GET /api/logs', () => {
  // One buffer per process, shared by every account. It records what the server
  // is doing, so it contains each tenant's sign-in results, each account
  // creation with its email and role, and absolute paths under the workspace.
  it('refuses a signed-in non-admin', async () => {
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'something happened' })

    const res = await appAs(MEMBER).request('/logs?limit=50')

    expect(res.status).toBe(403)
    expect(await res.text()).not.toContain('something happened')
  })

  it('serves an admin', async () => {
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'Admin created user member@example.com' })

    const res = await appAs(ADMIN).request('/logs?limit=50')

    expect(res.status).toBe(200)
    const body = await res.json() as { entries: { message: string }[] }
    expect(body.entries.some((e) => e.message.includes('Admin created user'))).toBe(true)
  })

  it('still validates the query before anything else', () => {
    // Not a route-level concern that an admin-only endpoint stopped
    // validating; the guard must not have swallowed it.
    return expect(appAs(ADMIN).request('/logs?limit=not-a-number')).resolves.toMatchObject({ status: 400 })
  })
})
