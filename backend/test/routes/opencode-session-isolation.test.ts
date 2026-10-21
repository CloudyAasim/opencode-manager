import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { Database } from 'bun:sqlite'
import { createAuthenticatedOpenCodeProxyRoutes } from '../../src/routes/opencode-auth-proxy'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { recordAgentSession } from '../../src/services/agent-session'
import { createTestDb } from '../helpers/assistant-workspace'
import { getUserWorkspacePath } from '@opencode-manager/shared/config/env'

/**
 * Two people, one repository, and the conversations in it.
 *
 * OpenCode files a conversation under a *project*, and a project is
 * identified by the git origin of the checkout it was opened in. Two
 * checkouts of the same repository are different directories and the same
 * project, so the upstream answers "the conversations in this project" to
 * both of them.
 *
 * That is what the list below is: what the upstream returns to either
 * person, and it contains the other person's conversations too.
 *
 * The manager is the only thing that knows who asked for a conversation,
 * so the proxy is where the answer has to be narrowed.
 */

const isolationDb: Database = createTestDb()

const isLifecycleInitializedMock = vi.hoisted(() => vi.fn().mockReturnValue(true))

vi.mock('../../src/services/opencode-single-server', () => ({
  opencodeServerManager: { isLifecycleInitialized: isLifecycleInitializedMock },
}))

const forwardRawMock = vi.hoisted(() =>
  vi.fn<OpenCodeClient['forwardRaw']>(async () => new Response('ok', { status: 200 })),
)
const getJsonMock = vi.hoisted(() => vi.fn(async () => ({}) as unknown))

vi.mock('../../src/services/opencode/client', () => ({
  createOpenCodeClient: vi.fn(),
}))

const passThroughAuth: MiddlewareHandler = async (_c, next) => {
  await next()
}

const ALICE = { id: 'u-alice', username: 'alice', role: 'user' } as const
const BOB = { id: 'u-bob', username: 'bob', role: 'user' } as const
const ADMIN = { id: 'u-admin', username: 'admin', role: 'admin' } as const

const aliceDirectory = `${getUserWorkspacePath('alice')}/repos/RelayAB`
const bobDirectory = `${getUserWorkspacePath('bob')}/repos/RelayAB`

/** The upstream's answer for either person: the whole project. */
function projectSessionList() {
  return JSON.stringify([
    { id: 'ses_alice', projectID: 'p1', directory: aliceDirectory, title: "Alice's work", time: { created: 1, updated: 2 } },
    { id: 'ses_bob', projectID: 'p1', directory: bobDirectory, title: "Bob's work", time: { created: 1, updated: 2 } },
  ])
}

function buildAppFor(who: typeof ALICE | typeof BOB | typeof ADMIN) {
  const app = new Hono()
  app.use('/*', async (c, next) => {
    ;(c as unknown as { set: (key: string, value: unknown) => void }).set('user', { ...who })
    await next()
  })
  app.route(
    '/api/opencode',
    createAuthenticatedOpenCodeProxyRoutes(
      {
        forwardRaw: forwardRawMock,
        getJson: getJsonMock,
      } as unknown as OpenCodeClient,
      passThroughAuth,
      isolationDb,
    ),
  )
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  isLifecycleInitializedMock.mockReturnValue(true)
  isolationDb.prepare('DELETE FROM ocm_agent_session').run()
  recordAgentSession(isolationDb, {
    sessionId: 'ses_alice',
    userId: ALICE.id,
    username: ALICE.username,
    role: ALICE.role,
    directory: aliceDirectory,
    source: 'proxy',
  })
  recordAgentSession(isolationDb, {
    sessionId: 'ses_bob',
    userId: BOB.id,
    username: BOB.username,
    role: BOB.role,
    directory: bobDirectory,
    source: 'proxy',
  })
  forwardRawMock.mockImplementation(async (request: Request) => {
    const path = new URL(request.url).pathname
    if (path === '/api/opencode/session') {
      return new Response(projectSessionList(), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('ok', { status: 200 })
  })
})

describe('one repository, two people', () => {
  it('shows each person only their own conversations', async () => {
    const res = await buildAppFor(ALICE).request(
      `/api/opencode/session?directory=${encodeURIComponent(aliceDirectory)}`,
    )

    expect(res.status).toBe(200)
    const sessions = (await res.json()) as Array<{ id: string }>
    expect(sessions.map((session) => session.id)).toEqual(['ses_alice'])
  })

  it('shows the other person their own conversations, not these', async () => {
    const res = await buildAppFor(BOB).request(
      `/api/opencode/session?directory=${encodeURIComponent(bobDirectory)}`,
    )

    expect(res.status).toBe(200)
    const sessions = (await res.json()) as Array<{ id: string }>
    expect(sessions.map((session) => session.id)).toEqual(['ses_bob'])
  })

  it('narrows a paged list as well', async () => {
    forwardRawMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: 'ses_alice', projectID: 'p1', directory: aliceDirectory, title: 'mine' },
            { id: 'ses_bob', projectID: 'p1', directory: bobDirectory, title: 'theirs' },
          ],
          cursor: { next: 'c2' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const res = await buildAppFor(ALICE).request(
      `/api/opencode/session?directory=${encodeURIComponent(aliceDirectory)}`,
    )

    const page = (await res.json()) as { data: Array<{ id: string }>; cursor?: { next?: string } }
    expect(page.data.map((session) => session.id)).toEqual(['ses_alice'])
    // The cursor is the upstream's, and it still points at the next page of
    // the project. Narrowing the list must not change it.
    expect(page.cursor?.next).toBe('c2')
  })

  it('lets a person read their own conversation', async () => {
    const res = await buildAppFor(ALICE).request(
      `/api/opencode/session/ses_alice/message?directory=${encodeURIComponent(aliceDirectory)}`,
    )

    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalled()
  })

  it('refuses to read somebody else\'s conversation', async () => {
    const res = await buildAppFor(ALICE).request(
      `/api/opencode/session/ses_bob/message?directory=${encodeURIComponent(aliceDirectory)}`,
    )

    expect(res.status).toBe(403)
    expect(forwardRawMock).not.toHaveBeenCalled()
  })

  it('refuses to delete somebody else\'s conversation', async () => {
    const res = await buildAppFor(ALICE).request(
      `/api/opencode/session/ses_bob?directory=${encodeURIComponent(aliceDirectory)}`,
      { method: 'DELETE' },
    )

    expect(res.status).toBe(403)
    expect(forwardRawMock).not.toHaveBeenCalled()
  })

  it('refuses to drive a conversation in somebody else\'s name', async () => {
    const res = await buildAppFor(ALICE).request(
      `/api/opencode/session/ses_bob/shell?directory=${encodeURIComponent(aliceDirectory)}`,
      { method: 'POST' },
    )

    expect(res.status).toBe(403)
    expect(forwardRawMock).not.toHaveBeenCalled()
  })
})

/**
 * The same repository, the other spelling of the API.
 *
 * The interface reads its list from `/api/session` and its messages from
 * `/session`, so a guard that only knows the first spelling is a door around
 * the second one. The newer list also says where a conversation lives in
 * `location` rather than in `directory`.
 */
describe('the other spelling of the same API', () => {
  const v2SessionList = () =>
    JSON.stringify({
      data: [
        { id: 'ses_alice', projectID: 'p1', title: 'mine', location: { directory: aliceDirectory } },
        { id: 'ses_bob', projectID: 'p1', title: 'theirs', location: { directory: bobDirectory } },
      ],
      cursor: { next: 'c2' },
    })

  it('narrows the list the interface actually reads', async () => {
    forwardRawMock.mockResolvedValue(
      new Response(v2SessionList(), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const res = await buildAppFor(ALICE).request(
      `/api/opencode/api/session?directory=${encodeURIComponent(aliceDirectory)}`,
    )

    expect(res.status).toBe(200)
    const page = (await res.json()) as { data: Array<{ id: string }>; cursor?: { next?: string } }
    expect(page.data.map((session) => session.id)).toEqual(['ses_alice'])
    expect(page.cursor?.next).toBe('c2')
  })

  it('shows the other person their own conversations there too', async () => {
    forwardRawMock.mockResolvedValue(
      new Response(v2SessionList(), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const res = await buildAppFor(BOB).request(
      `/api/opencode/api/session?directory=${encodeURIComponent(bobDirectory)}`,
    )

    const page = (await res.json()) as { data: Array<{ id: string }> }
    expect(page.data.map((session) => session.id)).toEqual(['ses_bob'])
  })

  it('refuses to read somebody else\'s conversation there too', async () => {
    const res = await buildAppFor(ALICE).request(
      `/api/opencode/api/session/ses_bob/message?directory=${encodeURIComponent(aliceDirectory)}`,
    )

    expect(res.status).toBe(403)
    expect(forwardRawMock).not.toHaveBeenCalled()
  })

  it('lets a person read their own conversation there too', async () => {
    const res = await buildAppFor(ALICE).request(
      `/api/opencode/api/session/ses_alice/message?directory=${encodeURIComponent(aliceDirectory)}`,
    )

    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalled()
  })
})

/**
 * The answers that are about conversations, without naming one.
 *
 * A pending permission, a pending question and the state of the
 * conversations are all about conversations, so all three are narrowed the
 * same way - and a permission that belongs to somebody else's conversation
 * is not the caller's to approve.
 */
describe('the answers that are about conversations', () => {
  const pendingRequests = () =>
    JSON.stringify([
      { id: 'per_mine', sessionID: 'ses_alice', permission: 'bash' },
      { id: 'per_theirs', sessionID: 'ses_bob', permission: 'bash' },
    ])

  it('narrows the pending permissions', async () => {
    forwardRawMock.mockResolvedValue(
      new Response(pendingRequests(), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const res = await buildAppFor(ALICE).request(
      `/api/opencode/permission?directory=${encodeURIComponent(aliceDirectory)}`,
    )

    expect(res.status).toBe(200)
    const pending = (await res.json()) as Array<{ id: string }>
    expect(pending.map((request) => request.id)).toEqual(['per_mine'])
  })

  it('narrows the pending questions', async () => {
    forwardRawMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: 'q_mine', sessionID: 'ses_alice', questions: [] },
          { id: 'q_theirs', sessionID: 'ses_bob', questions: [] },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const res = await buildAppFor(ALICE).request(
      `/api/opencode/question?directory=${encodeURIComponent(aliceDirectory)}`,
    )

    const pending = (await res.json()) as Array<{ id: string }>
    expect(pending.map((request) => request.id)).toEqual(['q_mine'])
  })

  it('narrows the state of the conversations', async () => {
    forwardRawMock.mockResolvedValue(
      new Response(
        JSON.stringify({ ses_alice: { type: 'idle' }, ses_bob: { type: 'busy' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const res = await buildAppFor(ALICE).request(
      `/api/opencode/session/status?directory=${encodeURIComponent(aliceDirectory)}`,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ses_alice: { type: 'idle' } })
  })

  it('refuses to approve a permission that belongs to somebody else\'s conversation', async () => {
    getJsonMock.mockResolvedValue([
      { id: 'per_theirs', sessionID: 'ses_bob', permission: 'bash' },
    ])

    const res = await buildAppFor(ALICE).request(
      `/api/opencode/permission/per_theirs/reply?directory=${encodeURIComponent(aliceDirectory)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply: 'once' }),
      },
    )

    expect(res.status).toBe(403)
    expect(forwardRawMock).not.toHaveBeenCalled()
  })

  it('lets a person approve a permission of their own conversation', async () => {
    getJsonMock.mockResolvedValue([
      { id: 'per_mine', sessionID: 'ses_alice', permission: 'bash' },
    ])

    const res = await buildAppFor(ALICE).request(
      `/api/opencode/permission/per_mine/reply?directory=${encodeURIComponent(aliceDirectory)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply: 'once' }),
      },
    )

    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalled()
  })
})

describe('who a conversation belongs to', () => {
  it('belongs to whoever asked for it, not to whoever can see the directory', async () => {
    // An administrator opening somebody else's repository leaves their own
    // conversation in it. The repository owner can see the directory, and
    // the conversation in it, and it is not theirs.
    recordAgentSession(isolationDb, {
      sessionId: 'ses_admin_in_bobs_repo',
      userId: ADMIN.id,
      username: ADMIN.username,
      role: ADMIN.role,
      directory: bobDirectory,
      source: 'proxy',
    })

    const res = await buildAppFor(BOB).request(
      `/api/opencode/session?directory=${encodeURIComponent(bobDirectory)}`,
    )
    const sessions = (await res.json()) as Array<{ id: string }>

    expect(sessions.map((session) => session.id)).toEqual(['ses_bob'])
  })

  it('shows an administrator everything', async () => {
    const res = await buildAppFor(ADMIN).request(
      `/api/opencode/session?directory=${encodeURIComponent(bobDirectory)}`,
    )
    const sessions = (await res.json()) as Array<{ id: string }>

    expect(sessions.map((session) => session.id)).toEqual(['ses_alice', 'ses_bob'])
  })

  it('still shows a conversation the ledger does not know about, in the caller\'s own directory', async () => {
    // Conversations from before the ledger existed have no owner recorded.
    // The directory they were created in is the only thing left to go on.
    forwardRawMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: 'ses_legacy', projectID: 'p1', directory: aliceDirectory, title: 'from before' },
          { id: 'ses_bob', projectID: 'p1', directory: bobDirectory, title: 'theirs' },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const res = await buildAppFor(ALICE).request(
      `/api/opencode/session?directory=${encodeURIComponent(aliceDirectory)}`,
    )
    const sessions = (await res.json()) as Array<{ id: string }>

    expect(sessions.map((session) => session.id)).toEqual(['ses_legacy'])
  })

  it('refuses a conversation the ledger does not know about and cannot place', async () => {
    // Not in the ledger, and the upstream cannot say where it lives: the
    // answer has to be "yes, it is yours" before anything is forwarded.
    getJsonMock.mockRejectedValue(new Error('not found'))

    const res = await buildAppFor(ALICE).request(
      `/api/opencode/session/ses_unknown/message?directory=${encodeURIComponent(aliceDirectory)}`,
    )

    expect(res.status).toBe(403)
    expect(forwardRawMock).not.toHaveBeenCalled()
  })

  it('allows a conversation the ledger does not know about when the upstream places it in the caller\'s directory', async () => {
    getJsonMock.mockResolvedValue({ id: 'ses_legacy', directory: aliceDirectory })

    const res = await buildAppFor(ALICE).request(
      `/api/opencode/session/ses_legacy/message?directory=${encodeURIComponent(aliceDirectory)}`,
    )

    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalled()
  })
})
