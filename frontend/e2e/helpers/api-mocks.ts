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
    revert: null,
    share: null,
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

  // The list of providers the agent knows, in the shape the app reads it in.
  // The catch-all above answers every agent path with an empty list, and this
  // one is not a list - it is an object with a list in it.
  await page.route(/.*\/api\/opencode\/(api\/)?config\/providers(\?.*)?$/, (route) =>
    json(route, { providers: [], connected: [], default: {} }),
  )

  // The layer the client talks to for its list. It is asked once for every
  // directory, and it answers with the list and one cursor per directory.
  //
  // Creating a conversation goes through the same layer: it is the layer that
  // knows who asked for it, and the client says only which working directory
  // it is created in.
  await page.route('**/api/bff/sessions', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { title?: string; directory?: string } | null
      const directory = body?.directory ?? DEFAULT_REPO.fullPath
      const title = body?.title ?? 'Untitled Session'
      const id = `ses_created_${state.createdSessions.length + 1}`
      state.createdSessions.push(id)
      state.sessionsByDirectory[directory] = [
        ...(state.sessionsByDirectory[directory] ?? []),
        { id, directory, title },
      ]
      return json(route, { session: bffSessionShape({ id, directory, title }) })
    }

    if (state.latency.sessionsMs) await sleep(state.latency.sessionsMs)
    const directories = new URL(route.request().url()).searchParams.getAll('directories')
    const sessions = directories.flatMap((directory) => state.sessionsByDirectory[directory] ?? [])
    return json(route, { sessions: sessions.map(bffSessionShape), cursors: {} })
  })

  // One conversation, through the same layer. The client names the
  // conversation; the layer works out where it lives.
  await page.route(/.*\/api\/bff\/sessions\/[^/?]+(\/abort)?(\?.*)?$/, async (route) => {
    const request = route.request()
    const method = request.method()
    const pathname = new URL(request.url()).pathname
    const id = /\/api\/bff\/sessions\/([^/?]+)/.exec(pathname)?.[1] ?? ''
    const all = Object.values(state.sessionsByDirectory).flat()
    const match = all.find((session) => session.id === id)

    if (method === 'POST') return json(route, { accepted: true })
    if (method === 'DELETE') {
      for (const [directory, sessions] of Object.entries(state.sessionsByDirectory)) {
        state.sessionsByDirectory[directory] = sessions.filter((session) => session.id !== id)
      }
      return json(route, { deleted: true, id })
    }
    if (method === 'PATCH') {
      const body = request.postDataJSON() as { title?: string } | null
      if (match && body?.title) match.title = body.title
      return json(route, { session: bffSessionShape(match ?? { id, directory: DEFAULT_REPO.fullPath }) })
    }

    if (state.latency.sessionMs) await sleep(state.latency.sessionMs)
    if (state.sessionDetailStatus !== 200) {
      return json(route, { error: { code: 'not_found', message: 'No session is known under that id' } }, state.sessionDetailStatus)
    }
    return json(route, { session: bffSessionShape(match ?? { id, directory: DEFAULT_REPO.fullPath }) })
  })

  // The same layer answers for what the agent is waiting for: both kinds in
  // one answer, for every directory at once.
  await page.route('**/api/bff/pending', (route) =>
    json(route, { permissions: [], questions: [] }),
  )

  // The conversation itself is read from the layer too, and in the versioned
  // dialect: a message and the pieces it is made of. The client names the
  // conversation; the layer works out where it lives.
  await page.route(/.*\/api\/bff\/sessions\/[^/?]+\/messages(\?.*)?$/, async (route) => {
    if (state.latency.messagesMs) await sleep(state.latency.messagesMs)
    return json(route, { messages: [] })
  })

  // Saying something to a conversation, and taking a message back, are the
  // layer's job as well.
  await page.route(/.*\/api\/bff\/sessions\/[^/?]+\/prompts(\?.*)?$/, (route) =>
    json(route, { accepted: true }),
  )
  await page.route(/.*\/api\/bff\/sessions\/[^/?]+\/revert(\?.*)?$/, (route) => {
    const id = /\/api\/bff\/sessions\/([^/?]+)/.exec(new URL(route.request().url()).pathname)?.[1] ?? ''
    return json(route, { session: bffSessionShape({ id, directory: DEFAULT_REPO.fullPath }) })
  })

  // Answering what the agent is waiting for hangs on a conversation, so the
  // conversation is named and the layer works out where it lives.
  await page.route(/.*\/api\/bff\/sessions\/[^/?]+\/permissions\/[^/?]+\/reply(\?.*)?$/, (route) =>
    json(route, { accepted: true }),
  )
  await page.route(/.*\/api\/bff\/sessions\/[^/?]+\/questions\/[^/?]+\/(reply|reject)(\?.*)?$/, (route) =>
    json(route, { accepted: true }),
  )

  // How busy everything is comes from the layer too, in the versioned dialect
  // - the same words the event stream says them in.
  await page.route('**/api/bff/status', (route) => json(route, { statuses: {} }))

  // The agent's own face comes from the layer as well, in the versioned
  // dialect: the commands it knows, the ways of working, and the two
  // defaults. The client draws the command palette from here now, so the
  // shapes here are the versioned ones.
  await page.route('**/api/bff/commands', (route) =>
    json(route, {
      commands: [
        {
          name: 'review',
          description: 'looks at the code',
          workingMode: null,
          model: null,
          template: null,
          subtask: false,
          hints: [],
        },
      ],
    }),
  )
  await page.route('**/api/bff/working-modes', (route) =>
    json(route, {
      workingModes: [
        {
          name: 'build',
          description: 'writes the code',
          scope: 'all',
          hidden: false,
          color: null,
          model: null,
        },
      ],
    }),
  )
  await page.route('**/api/bff/defaults', (route) =>
    json(route, { defaults: { model: null, workingMode: null } }),
  )

  // What hangs on a conversation is asked of the layer, with the conversation
  // named: a command run in it, a summary written for it, a copy taken of it,
  // and a line run in its own shell.
  await page.route(/.*\/api\/bff\/sessions\/[^/?]+\/(commands|summarize|shell)(\?.*)?$/, (route) =>
    json(route, { accepted: true }),
  )
  await page.route(/.*\/api\/bff\/sessions\/[^/?]+\/fork(\?.*)?$/, (route) => {
    const id = /\/api\/bff\/sessions\/([^/?]+)/.exec(new URL(route.request().url()).pathname)?.[1] ?? ''
    return json(route, { session: bffSessionShape({ id, directory: DEFAULT_REPO.fullPath }) })
  })

  // The agent's own door for its own face is closed: the commands it knows,
  // the ways of working it can be, and the two defaults are the layer's to
  // answer, in the layer's dialect. A mock that quietly answered the old call
  // would hide a client that went back to asking the agent.
  await page.route(/.*\/api\/opencode\/(api\/)?(command|agent)(\?.*)?$/, () => {
    throw new Error('The client asked the agent about its own face; it must ask the layer instead')
  })

  // And so is the door for what hangs on a conversation: a command run in it,
  // a summary written for it, a copy taken of it, a line run in its shell.
  await page.route(
    /.*\/api\/opencode\/(api\/)?session\/[^/?]+\/(command|shell|fork|summarize)(\?.*)?$/,
    () => {
      throw new Error('The client asked the agent to do something in a conversation; it must ask the layer instead')
    },
  )

  // The client's own door for the conversation is closed: the conversation is
  // the layer's, in the layer's words. A mock that quietly answered the old
  // call would hide a client that went back to asking the agent.
  await page.route(/.*\/api\/opencode\/(api\/)?session\/[^/?]+\/(message|messages|prompt|prompt_async|revert)(\?.*)?$/, () => {
    throw new Error('The client asked the agent about the conversation; it must ask the layer instead')
  })

  // The client used to ask the agent for the pending permissions and the
  // pending questions of every directory, and merge the answers itself. It
  // must not do that any more: two round trips per directory, and the agent's
  // dialect in the app, are both the server's job.
  await page.route(/.*\/api\/opencode\/(api\/)?(permission|question)(\?.*)?$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    throw new Error('The client asked the agent for its pending lists; it must ask the layer instead')
  })

  // And answering them is the layer's job as well - the agent's own door for
  // it is closed, so a client that went back to using it would be caught.
  await page.route(/.*\/api\/opencode\/(api\/)?(permission|question)\/[^/?]+\/(reply|reject)(\?.*)?$/, () => {
    throw new Error('The client asked the agent about what it is waiting for; it must ask the layer instead')
  })

  // How busy the agent is came from the agent in the agent's own words, while
  // the conversation came from the layer in the layer's words - and the client
  // held both. It is the layer's now, in one dialect.
  await page.route(/.*\/api\/opencode\/(api\/)?session\/status(\?.*)?$/, () => {
    throw new Error('The client asked the agent how busy it is; it must ask the layer instead')
  })

  // The client used to ask the agent for its list and merge the answers
  // itself. It must not do that any more: merging pages and keeping a cursor
  // per directory is the server's job, and a mock that quietly answered the
  // old call would hide a client that went back to doing it.
  await page.route(/.*\/api\/opencode\/(api\/)?session(\?.*)?$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    throw new Error('The client asked the agent for its session list; it must ask the layer instead')
  })

  // Creating a conversation goes through the layer too: it is the layer that
  // knows who asked for it. The agent's own door is closed for that.
  await page.route(/.*\/api\/opencode\/(api\/)?session(\?.*)?$/, (route) => {
    if (route.request().method() === 'GET') return route.fallback()
    throw new Error('The client asked the agent to create a conversation; it must ask the layer instead')
  })

  // So do renaming it, deleting it and stopping it: the layer knows where the
  // conversation lives, and the client does not.
  await page.route(/.*\/api\/opencode\/session\/[^/?]+(\?.*)?$/, (route) => {
    const method = route.request().method()
    if (method === 'GET') return route.fallback()
    throw new Error('The client asked the agent to change a conversation; it must ask the layer instead')
  })

  await page.route(/.*\/api\/opencode\/session\/[^/?]+\/abort(\?.*)?$/, (_route) => {
    throw new Error('The client asked the agent to stop a conversation; it must ask the layer instead')
  })

  await page.route(/.*\/api\/opencode\/session\/[^/?]+(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
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
