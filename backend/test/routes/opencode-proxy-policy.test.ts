import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { Database } from 'bun:sqlite'
import { createAuthenticatedOpenCodeProxyRoutes } from '../../src/routes/opencode-auth-proxy'
import {
  matchProxyRoute,
  requestIdFromUpstreamPath,
  sessionIdFromUpstreamPath,
  upstreamPathFrom,
} from '../../src/routes/opencode-proxy-policy'
import { getUserSettingPath } from '@opencode-manager/shared/config/env'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { createTestDb } from '../helpers/assistant-workspace'

const proxyTestDb = createTestDb()

const isLifecycleInitializedMock = vi.hoisted(() => vi.fn().mockReturnValue(true))

vi.mock('../../src/services/opencode-single-server', () => ({
  opencodeServerManager: { isLifecycleInitialized: isLifecycleInitializedMock },
}))

const forwardRawMock = vi.hoisted(() =>
  vi.fn<OpenCodeClient['forwardRaw']>(async () => new Response('ok', { status: 200 })),
)

vi.mock('../../src/services/opencode/client', () => ({
  createOpenCodeClient: vi.fn(),
}))

/**
 * The endpoints that are about the server rather than about one working
 * directory.
 *
 * They are the ones a pass-through route would hand to anybody who can log
 * in, and the ones that matter: the configuration document every session on
 * this host reads, the command that throws the server away, the credential
 * store everybody shares, and a shell that is not the manager's terminal.
 */
const SERVER_WIDE_REQUESTS: readonly { method: string; path: string; why: string }[] = [
  { method: 'PATCH', path: '/global/config', why: 'writes the configuration every session reads' },
  { method: 'GET', path: '/global/config', why: 'reads the same document' },
  { method: 'POST', path: '/global/dispose', why: 'throws the server away' },
  { method: 'POST', path: '/global/upgrade', why: 'replaces the binary' },
  { method: 'GET', path: '/global/event', why: 'is every conversation on the host' },
  { method: 'PUT', path: '/auth/anthropic', why: 'is the credential store everybody shares' },
  { method: 'POST', path: '/pty', why: 'is a shell outside the manager’s terminal rules' },
  { method: 'POST', path: '/tui/submit-prompt', why: 'drives the interface of the server' },
  { method: 'POST', path: '/instance/dispose', why: 'throws a working directory away' },
  { method: 'GET', path: '/file/content', why: 'reads files outside the caller’s directories' },
  { method: 'GET', path: '/find', why: 'searches outside the caller’s directories' },
  { method: 'POST', path: '/log', why: 'writes into the server’s log' },
  { method: 'PATCH', path: '/project/prj_1', why: 'changes a project everybody shares' },
  { method: 'POST', path: '/experimental/worktree', why: 'creates a checkout on the host' },
  { method: 'POST', path: '/mcp', why: 'adds a server that runs a command' },
  { method: 'POST', path: '/mcp/evil/auth', why: 'starts a flow for a server nobody added' },
  { method: 'DELETE', path: '/mcp/evil/auth', why: 'removes a server’s credentials' },
]

/**
 * The endpoints that are about one working directory, and are therefore
 * allowed - they are the ones the interface actually calls.
 */
const ALLOWED_REQUESTS: readonly { method: string; path: string }[] = [
  { method: 'GET', path: '/session' },
  { method: 'GET', path: '/api/session' },
  { method: 'GET', path: '/session/status' },
  { method: 'GET', path: '/config' },
  { method: 'GET', path: '/config/providers' },
  { method: 'GET', path: '/provider' },
  { method: 'GET', path: '/command' },
  { method: 'GET', path: '/agent' },
  { method: 'GET', path: '/permission' },
  { method: 'GET', path: '/question' },
  { method: 'GET', path: '/mcp' },
]

function buildFor(user: { id: string; username?: string; role: 'admin' | 'user' } | null, db: Database = proxyTestDb) {
  const app = new Hono()
  const asCaller: MiddlewareHandler = async (c, next) => {
    if (user) c.set('user' as never, user as never)
    await next()
  }
  app.route(
    '/api/opencode',
    createAuthenticatedOpenCodeProxyRoutes(
      { forwardRaw: forwardRawMock } as unknown as OpenCodeClient,
      asCaller,
      db,
    ),
  )
  return app
}

const asPerson = buildFor({ id: 'u-alice', username: 'alice', role: 'user' })
const asAdministrator = buildFor({ id: 'u-root', username: 'root', role: 'admin' })

describe('what a person may ask the OpenCode server for', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isLifecycleInitializedMock.mockReturnValue(true)
    forwardRawMock.mockResolvedValue(new Response('ok', { status: 200 }))
  })

  it.each(SERVER_WIDE_REQUESTS)(
    'refuses $method $path from a person, because it $why',
    async ({ method, path }) => {
      const res = await asPerson.request(`/api/opencode${path}`, { method })

      expect(res.status).toBe(403)
      expect(forwardRawMock).not.toHaveBeenCalled()
    },
  )

  it.each(ALLOWED_REQUESTS)('forwards $method $path to a person', async ({ method, path }) => {
    const res = await asPerson.request(`/api/opencode${path}`, { method })

    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalledTimes(1)
  })

  it('lets the administrator reach the endpoints that are about the server', async () => {
    for (const request of SERVER_WIDE_REQUESTS) {
      const res = await asAdministrator.request(`/api/opencode${request.path}`, { method: request.method })
      expect(res.status, `${request.method} ${request.path}`).toBe(200)
    }
    expect(forwardRawMock).toHaveBeenCalledTimes(SERVER_WIDE_REQUESTS.length)
  })

  it('refuses a write that does not name a working directory', async () => {
    const res = await asPerson.request('/api/opencode/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })

    expect(res.status).toBe(403)
    expect(forwardRawMock).not.toHaveBeenCalled()
  })

  it('refuses a write into a working directory that is not the caller’s', async () => {
    const res = await asPerson.request(
      `/api/opencode/session?directory=${encodeURIComponent(`${getUserSettingPath('bob')}/assistant`)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    )

    expect(res.status).toBe(403)
    expect(forwardRawMock).not.toHaveBeenCalled()
  })

  it('lets a person write into a working directory of their own', async () => {
    const directory = `${getUserSettingPath('alice')}/assistant`
    const res = await asPerson.request(
      `/api/opencode/session?directory=${encodeURIComponent(directory)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    )

    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalledTimes(1)
  })

  it('reads the path with its encoding undone, so a hidden path is refused too', async () => {
    // `%70ty` is `/pty`. A list that only matched the readable spelling
    // would be walked straight through by the encoded one.
    const res = await asPerson.request('/api/opencode/%70ty', { method: 'POST' })

    expect(res.status).toBe(403)
    expect(forwardRawMock).not.toHaveBeenCalled()
  })

  it('never forwards a path that tries to climb out of its own directory', async () => {
    const res = await asPerson.request('/api/opencode/%2e%2e/global/config', { method: 'PATCH' })

    // Whether the request is refused by the router or by the list, the one
    // thing that must not happen is the upstream seeing it.
    expect(res.status).not.toBe(200)
    expect(forwardRawMock).not.toHaveBeenCalled()
  })
})

describe('the list of routes, on its own', () => {
  it('undoes the encoding before it matches', () => {
    expect(upstreamPathFrom('/%70ty')).toBe('/pty')
    expect(matchProxyRoute('POST', '/%70ty')).toBeNull()
  })

  it('refuses a path that climbs out of its own directory', () => {
    expect(upstreamPathFrom('/../global/config')).toBeNull()
    expect(upstreamPathFrom('/session/../../global/config')).toBeNull()
  })

  it('refuses a path it cannot read', () => {
    expect(upstreamPathFrom('/%E0%A4%A')).toBeNull()
  })

  it('knows both spellings of the conversation API', () => {
    expect(sessionIdFromUpstreamPath('/session/ses_1/message')).toBe('ses_1')
    expect(sessionIdFromUpstreamPath('/api/session/ses_1/message')).toBe('ses_1')
    expect(sessionIdFromUpstreamPath('/session')).toBeNull()
  })

  it('knows which pending request a path names', () => {
    expect(requestIdFromUpstreamPath('/permission/per_1/reply')).toEqual({ kind: 'permission', id: 'per_1' })
    expect(requestIdFromUpstreamPath('/question/q_1/reject')).toEqual({ kind: 'question', id: 'q_1' })
    expect(requestIdFromUpstreamPath('/permission')).toBeNull()
  })

  it('has no route for the endpoints that are about the server', () => {
    for (const path of ['/global/config', '/global/dispose', '/pty', '/auth/anthropic', '/tui/submit-prompt']) {
      expect(matchProxyRoute('GET', path), path).toBeNull()
      expect(matchProxyRoute('POST', path), path).toBeNull()
      expect(matchProxyRoute('PATCH', path), path).toBeNull()
      expect(matchProxyRoute('PUT', path), path).toBeNull()
    }
  })
})
