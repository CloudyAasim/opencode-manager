import type { Page, Route } from '@playwright/test'

export interface SessionSummary {
  id: string
  directory: string
  title?: string
  created?: number
}

export interface RepoFixture {
  id: number
  fullPath: string
  localPath: string
  cloneStatus?: 'ready' | 'cloning' | 'error'
}

export interface MockLatency {
  repoMs?: number
  sessionsMs?: number
  sessionMs?: number
  messagesMs?: number
}

export interface MockState {
  repos: RepoFixture[]
  sessionsByDirectory: Record<string, SessionSummary[]>
  createdSessions: string[]
  sessionDetailStatus: number
  latency: MockLatency
}

const DEFAULT_REPO: RepoFixture = {
  id: 1,
  fullPath: '/workspace/repos/demo',
  localPath: 'demo',
  cloneStatus: 'ready',
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sessionShape(session: SessionSummary) {
  return {
    id: session.id,
    projectID: 'project-1',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: session.created ?? Date.now(), updated: session.created ?? Date.now() },
    title: session.title ?? 'Untitled Session',
    location: { directory: session.directory },
    directory: session.directory,
    version: 'v2',
  }
}

/**
 * The same session, as the layer the client talks to hands it over.
 *
 * The list comes from there now, and the two shapes say different things: the
 * agent's own session has a time and a project, the layer's has the working
 * directory and the time of the last change.
 */
function bffSessionShape(session: SessionSummary) {
  const updated = session.created ?? Date.now()
  return {
    id: session.id,
    agentId: 'opencode',
    title: session.title ?? 'Untitled Session',
    directory: session.directory,
    workspaceId: null,
    parentId: null,
    createdAt: updated,
    updatedAt: updated,
    archived: false,
    status: 'idle',
  }
}

/**
 * Installs a deterministic API surface so specs can exercise routing and
 * timing without a backend. Latency is injectable on purpose: the bugs this
 * suite exists to catch (a redirect firing before the session list resolves,
 * an effect re-running on an unstable dependency) only appear when responses
 * arrive late relative to each other.
 */
export async function installApiMocks(page: Page, overrides: Partial<MockState> = {}): Promise<MockState> {
  const state: MockState = {
    repos: overrides.repos ?? [DEFAULT_REPO],
    sessionsByDirectory: overrides.sessionsByDirectory ?? {
      [DEFAULT_REPO.fullPath]: [],
    },
    createdSessions: [],
    sessionDetailStatus: overrides.sessionDetailStatus ?? 200,
    latency: { repoMs: 0, sessionsMs: 0, sessionMs: 0, messagesMs: 0, ...overrides.latency },
  }

  for (const [directory, sessions] of Object.entries(state.sessionsByDirectory)) {
    for (const session of sessions) session.directory ??= directory
  }

  await page.route('**/api/auth/get-session', (route) =>
    json(route, {
      session: { id: 'session-1', userId: 'user-1', expiresAt: '2099-01-01T00:00:00.000Z' },
      user: { id: 'user-1', email: 'admin@example.com', name: 'Admin' },
    }),
  )
  await page.route('**/api/auth-info/config', (route) =>
    json(route, { emailAndPassword: true, passkey: false, providers: [] }),
  )
  await page.route('**/api/settings**', (route) =>
    json(route, { preferences: { expandToolCalls: false }, tts: {}, stt: {} }),
  )
  await page.route('**/api/terminal/config', (route) => json(route, { allowed: false }))
  await page.route('**/api/health/version', (route) => json(route, { version: '0.0.0-test' }))
  await page.route('**/api/health**', (route) => json(route, { status: 'healthy' }))
  await page.route('**/api/sse/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }),
  )

  await page.route('**/api/repos', (route) => json(route, state.repos))
  await page.route('**/api/repos/*/siblings', (route) => json(route, []))
  await page.route('**/api/repos/*/git*', (route) => json(route, { files: [], ahead: 0, behind: 0 }))
  await page.route(/.*\/api\/repos\/(\d+)$/, async (route) => {
    if (state.latency.repoMs) await sleep(state.latency.repoMs)
    const id = Number(/\/api\/repos\/(\d+)$/.exec(new URL(route.request().url()).pathname)?.[1] ?? -1)
    const repo = state.repos.find((candidate) => candidate.id === id)
    return repo ? json(route, repo) : json(route, { error: 'Repo not found' }, 404)
  })

  // Registered first on purpose: Playwright matches routes last-registered-first,
  // so the catch-all must precede the specific opencode handlers below.
  await page.route('**/api/opencode/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname.includes('/message') && state.latency.messagesMs) {
      await sleep(state.latency.messagesMs)
    }
    return json(route, [])
  })

  // The layer the client talks to for its list. It is asked once for every
  // directory, and it answers with the list and one cursor per directory.
  await page.route('**/api/bff/sessions', async (route) => {
    if (state.latency.sessionsMs) await sleep(state.latency.sessionsMs)
    const directories = new URL(route.request().url()).searchParams.getAll('directories')
    const sessions = directories.flatMap((directory) => state.sessionsByDirectory[directory] ?? [])
    return json(route, { sessions: sessions.map(bffSessionShape), cursors: {} })
  })

  // The same layer answers for what the agent is waiting for: both kinds in
  // one answer, for every directory at once.
  await page.route('**/api/bff/pending', (route) =>
    json(route, { permissions: [], questions: [] }),
  )

  // The client used to ask the agent for the pending permissions and the
  // pending questions of every directory, and merge the answers itself. It
  // must not do that any more: two round trips per directory, and the agent's
  // dialect in the app, are both the server's job.
  await page.route(/.*\/api\/opencode\/(api\/)?(permission|question)(\?.*)?$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    throw new Error('The client asked the agent for its pending lists; it must ask the layer instead')
  })

  // The client used to ask the agent for its list and merge the answers
  // itself. It must not do that any more: merging pages and keeping a cursor
  // per directory is the server's job, and a mock that quietly answered the
  // old call would hide a client that went back to doing it.
  //
  // Only the reading of it. Creating a session still goes to the agent - that
  // is not the list, and it did not move.
  await page.route(/.*\/api\/opencode\/(api\/)?session(\?.*)?$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    throw new Error('The client asked the agent for its session list; it must ask the layer instead')
  })

  await page.route(/.*\/api\/opencode\/session\/[^/?]+(\?.*)?$/, async (route) => {
    if (state.latency.sessionMs) await sleep(state.latency.sessionMs)
    if (state.sessionDetailStatus !== 200) {
      return json(route, { error: 'not found' }, state.sessionDetailStatus)
    }
    const id = /\/api\/opencode\/session\/([^/?]+)/.exec(new URL(route.request().url()).pathname)?.[1] ?? ''
    const all = Object.values(state.sessionsByDirectory).flat()
    const match = all.find((session) => session.id === id)
    return json(route, sessionShape(match ?? { id, directory: DEFAULT_REPO.fullPath }))
  })

  return state
}

export function makeSession(id: string, directory: string, title = 'Untitled Session'): SessionSummary {
  return { id, directory, title, created: Date.now() }
}
