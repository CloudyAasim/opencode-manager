import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createTerminalRoutes } from '../../src/routes/terminal'
import { TerminalManager } from '../../src/services/terminal/manager'
import { createTestDb } from '../helpers/assistant-workspace'
import { createSessionUser } from '../helpers/session-user'
import { FakePtySpawner } from '../helpers/fake-pty'
import type { Session } from '../../src/auth'

const { ENV } = vi.hoisted(() => ({
  ENV: {
    AUTH: { TRUST_PROXY: false },
    TERMINAL: {
      ENABLED: true,
      SHELL: '/bin/bash',
      CWD: '/workspace',
      COLS: 100,
      ROWS: 30,
      MAX_SESSIONS_PER_USER: 2,
      MAX_SESSIONS_TOTAL: 4,
      IDLE_TIMEOUT_MS: 900000,
      MAX_DURATION_MS: 28800000,
      ADMINS_ONLY: true,
    },
  },
}))

vi.mock('@opencode-manager/shared/config/env', () => ({ ENV }))
vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

function createApp(manager: TerminalManager, role: 'admin' | 'user') {
  const root = new Hono<{ Variables: { user: Session['user']; session: Session['session'] } }>()
  root.use('/*', async (c, next) => {
    c.set('user', createSessionUser(role))
    c.set('session', { id: 'session-1' } as Session['session'])
    await next()
  })
  root.route('/', createTerminalRoutes(manager) as unknown as Hono)
  return root
}

function firstProcess(spawner: FakePtySpawner) {
  const process = spawner.processes[0]
  if (!process) throw new Error('expected a spawned PTY process')
  return process
}

async function readUntil(response: Response, needle: string, timeoutMs = 3000): Promise<string> {  const reader = response.body?.getReader()
  if (!reader) throw new Error('response has no body')
  const decoder = new TextDecoder()
  let output = ''
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      const result = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), Math.max(1, deadline - Date.now())),
        ),
      ])
      if (result.done) break
      if (result.value) output += decoder.decode(result.value, { stream: true })
      if (output.includes(needle)) break
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return output
}

describe('terminal routes', () => {
  let db: ReturnType<typeof createTestDb>
  let spawner: FakePtySpawner
  let manager: TerminalManager

  beforeEach(() => {
    ENV.TERMINAL.ENABLED = true
    ENV.TERMINAL.ADMINS_ONLY = true
    db = createTestDb()
    spawner = new FakePtySpawner()
    manager = new TerminalManager(db, spawner)
  })

  afterEach(() => {
    manager.shutdown()
    db.close()
  })

  it('rejects non-admins when admin-only', async () => {
    const app = createApp(manager, 'user')

    const res = await app.request('/config')

    expect(res.status).toBe(403)
  })

  it('exposes runtime config', async () => {
    const app = createApp(manager, 'admin')

    const res = await app.request('/config')

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ enabled: true, available: true, adminsOnly: true })
  })

  it('creates a session, forwards input, resizes and closes it', async () => {
    const app = createApp(manager, 'admin')

    const created = await app.request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols: 90, rows: 25 }),
    })
    expect(created.status).toBe(201)
    const { session } = await created.json() as { session: { id: string } }

    const input = await app.request(`/sessions/${session.id}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'ls\n' }),
    })
    expect(input.status).toBe(204)
    expect(firstProcess(spawner).written).toEqual(['ls\n'])

    const resize = await app.request(`/sessions/${session.id}/resize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols: 120, rows: 40 }),
    })
    expect(resize.status).toBe(200)
    expect(firstProcess(spawner).resizes).toEqual([{ cols: 120, rows: 40 }])

    const closed = await app.request(`/sessions/${session.id}`, { method: 'DELETE' })
    expect(closed.status).toBe(200)
    expect(firstProcess(spawner).killed).toBe(true)
  })

  it('rejects invalid input payloads', async () => {
    const app = createApp(manager, 'admin')
    const created = await app.request('/sessions', { method: 'POST', body: '{}' })
    const { session } = await created.json() as { session: { id: string } }

    const res = await app.request(`/sessions/${session.id}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'x'.repeat(70 * 1024) }),
    })

    expect(res.status).toBe(400)
  })

  it('streams buffered output over SSE', async () => {
    const app = createApp(manager, 'admin')
    const created = await app.request('/sessions', { method: 'POST', body: '{}' })
    const { session } = await created.json() as { session: { id: string } }

    firstProcess(spawner).emitData('hello from pty\r\n')

    const res = await app.request(`/sessions/${session.id}/stream`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const body = await readUntil(res, 'hello from pty')

    expect(body).toContain('event: ready')
    expect(body).toContain('event: output')
    expect(body).toContain('hello from pty')
  })
})
