import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { Database } from 'bun:sqlite'
import { opencodeServerManager } from '../services/opencode-single-server'
import type { OpenCodeClient } from '../services/opencode/client'
import { principalFrom, principalIsAdmin, resolveAccessRoots } from '../auth/ownership'
import type { Principal } from '../auth/ownership'
import { isWithinRoots } from '../auth/access-scope'
import type { Session } from '../auth'
import { recordAgentSession, findAgentSession, findAgentSessions } from '../services/agent-session'
import {
  requestSessionIdOf,
  sessionBelongsToCaller,
  sessionDirectoryOf,
  sessionIdOf,
  sessionVisibleTo,
} from '../services/session-scope'
import type { AgentSession } from '../services/agent-session'
import {
  matchProxyRoute,
  requestIdFromUpstreamPath,
  sessionIdFromUpstreamPath,
  upstreamPathFrom,
  type ProxyScope,
} from './opencode-proxy-policy'
import { getErrorMessage } from '../utils/error-utils'
import { logger } from '../utils/logger'

/**
 * The path the browser reaches the OpenCode API on.
 *
 * The session list lives at `/session`, and a session is addressed as
 * `/session/<id>` with the rest of the path hanging off it. The newer
 * spelling of the same API lives under `/api/session`, and the interface
 * reads the list from one and the messages from the other - so both have to
 * be understood here, or the narrow one is a door around the wide one.
 */
const PROXY_PREFIX = '/api/opencode'

/**
 * The provider list is the answer to "what models can I pick", and it is the
 * same answer every time. Upstream rebuilds it from scratch on every call, so
 * opening the model picker waited on that work each time.
 *
 * Five minutes: long enough that the picker is warm for a sitting session,
 * short enough that a newly configured provider shows up without a restart.
 *
 * Keyed by user on purpose. `connected` in that payload reflects that user's
 * opencode credentials, so a shared entry would show one tenant another's
 * providers.
 */
const PROVIDER_CACHE_TTL_MS = 5 * 60 * 1000
const PROVIDER_CACHE_MAX_ENTRIES = 64
const providerCache = new Map<
  string,
  { status: number; contentType: string; body: ArrayBuffer; expiresAt: number }
>()

function readCachedProviderList(key: string): Response | null {
  const hit = providerCache.get(key)
  if (!hit) return null
  if (hit.expiresAt <= Date.now()) {
    providerCache.delete(key)
    return null
  }
  return new Response(hit.body, {
    status: hit.status,
    headers: {
      'content-type': hit.contentType,
      'x-opencode-provider-cache': 'hit',
    },
  })
}

function rememberProviderList(key: string, source: Response, body: ArrayBuffer): void {
  if (providerCache.size >= PROVIDER_CACHE_MAX_ENTRIES) {
    const oldest = providerCache.keys().next().value
    if (oldest !== undefined) providerCache.delete(oldest)
  }
  providerCache.set(key, {
    status: source.status,
    contentType: source.headers.get('content-type') ?? 'application/json',
    body,
    expiresAt: Date.now() + PROVIDER_CACHE_TTL_MS,
  })
}

/**
 * `POST /session` is the one call that mints a session, and it is the only
 * moment where both halves of the answer exist at the same time: who asked,
 * and which id came back. Trailing slash tolerated; anything deeper
 * (`/session/ses_1/message`) is a different endpoint and is not matched.
 */
function isSessionCreation(method: string, pathname: string): boolean {
  if (method !== 'POST') return false
  const trimmed = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  return trimmed.endsWith('/session')
}

/**
 * Noting the owner down is bookkeeping, not the request. A session that could
 * not be recorded still works; what is lost is the note that would later let
 * the internal API tell tenants apart, and that shows up loudly the moment
 * enforcement is switched on. Failing the creation instead would turn a
 * bookkeeping gap into an outage.
 *
 * Returning early on a missing principal - rather than letting the try below
 * swallow the resulting TypeError - is what keeps "nobody to record" quiet.
 * Nothing went wrong there, so a warning would be a lie.
 */
async function recordCreatedSession(
  database: Database,
  response: Response,
  principal: Principal | null,
  directory: string | null,
): Promise<void> {
  if (!principal) return

  try {
    const payload = await response.clone().json() as { id?: unknown } | null
    const sessionId = typeof payload?.id === 'string' ? payload.id : null
    if (!sessionId) return

    recordAgentSession(database, {
      sessionId,
      userId: principal.id,
      username: principal.username ?? null,
      role: principal.role,
      directory,
      source: 'proxy',
    })
  } catch (error) {
    logger.warn(`Could not record the owner of a new OpenCode session: ${getErrorMessage(error)}`)
  }
}

/**
 * The directory a conversation was created in, as the upstream sees it.
 *
 * Only used for conversations the ledger does not know about - the ones
 * from before it existed. A failure to find out is a failure to allow:
 * the answer has to be "yes, it is yours" before anything is forwarded.
 */
async function sessionDirectoryFromUpstream(
  openCodeClient: OpenCodeClient,
  sessionId: string,
  directory: string | null,
): Promise<string | null> {
  try {
    const session = await openCodeClient.getJson<{ directory?: string }>(
      `/session/${encodeURIComponent(sessionId)}`,
      { directory: directory ?? undefined },
    )
    return typeof session?.directory === 'string' ? session.directory : null
  } catch {
    return null
  }
}

/**
 * A page of items, and how to put the kept ones back.
 *
 * Two shapes have come in over the years: a plain list, and an envelope
 * with `data` or `items` in it. The envelope keeps its other fields - the
 * cursor, the counts - because the interface pages with them.
 */
interface ListPayload {
  items: unknown[]
  rebuild: (kept: unknown[]) => unknown
}

function listPayloadOf(payload: unknown): ListPayload | null {
  if (Array.isArray(payload)) {
    return { items: payload, rebuild: (kept) => kept }
  }
  if (payload && typeof payload === 'object') {
    const envelope = payload as { data?: unknown; items?: unknown }
    if (Array.isArray(envelope.data)) {
      return { items: envelope.data, rebuild: (kept) => ({ ...envelope, data: kept }) }
    }
    if (Array.isArray(envelope.items)) {
      return { items: envelope.items, rebuild: (kept) => ({ ...envelope, items: kept }) }
    }
  }
  return null
}

function jsonResponse(response: Response, payload: unknown): Response {
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * The caller's own conversations out of a page of sessions.
 *
 * Returns null when the page is already fine, so the original response goes
 * out untouched - a list that needed no narrowing should not be re-serialised
 * for nothing.
 */
async function filterSessionListResponse(
  response: Response,
  database: Database,
  principal: Principal,
  roots: readonly string[],
): Promise<Response | null> {
  let payload: unknown
  try {
    payload = await response.clone().json()
  } catch {
    return null
  }

  const list = listPayloadOf(payload)
  if (!list || list.items.length === 0) return null

  const summaries = list.items.map((item) => ({
    id: sessionIdOf(item) ?? '',
    directory: sessionDirectoryOf(item),
  }))
  const records = findAgentSessions(database, summaries.map((summary) => summary.id))
  const kept = list.items.filter((_, index) => {
    const summary = summaries[index]!
    if (!summary.id) return false
    return sessionVisibleTo(summary, records.get(summary.id), principal, roots)
  })
  if (kept.length === list.items.length) return null

  return jsonResponse(response, list.rebuild(kept))
}

/**
 * A pending request - a permission or a question - belongs to a
 * conversation, so the conversation decides whether this person may see it.
 *
 * The ledger knows who owns most conversations. When it does not, the
 * request belongs to a conversation in the caller's own working directory,
 * and the ledger has no reason to say otherwise.
 */
function requestVisibleTo(
  item: unknown,
  records: ReadonlyMap<string, AgentSession>,
  principal: Principal,
): boolean {
  const sessionID = requestSessionIdOf(item)
  if (!sessionID) return false
  const record = records.get(sessionID)
  if (!record) return true
  return record.userId === principal.id
}

async function filterRequestListResponse(
  response: Response,
  database: Database,
  principal: Principal,
): Promise<Response | null> {
  let payload: unknown
  try {
    payload = await response.clone().json()
  } catch {
    return null
  }

  const list = listPayloadOf(payload)
  if (!list || list.items.length === 0) return null

  const sessionIDs = list.items
    .map((item) => requestSessionIdOf(item))
    .filter((id): id is string => typeof id === 'string')
  const records = findAgentSessions(database, sessionIDs)
  const kept = list.items.filter((item) => requestVisibleTo(item, records, principal))
  if (kept.length === list.items.length) return null

  return jsonResponse(response, list.rebuild(kept))
}

/**
 * The state of every conversation in the working directory: busy, idle, or
 * waiting to retry. The keys are conversation ids, so the same rule as the
 * conversation list applies - the ledger decides.
 */
async function filterStatusMapResponse(
  response: Response,
  database: Database,
  principal: Principal,
): Promise<Response | null> {
  let payload: unknown
  try {
    payload = await response.clone().json()
  } catch {
    return null
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const entries = Object.entries(payload as Record<string, unknown>)
  if (entries.length === 0) return null

  const records = findAgentSessions(database, entries.map(([id]) => id))
  const kept = entries.filter(([id]) => {
    const record = records.get(id)
    if (!record) return true
    return record.userId === principal.id
  })
  if (kept.length === entries.length) return null

  return jsonResponse(response, Object.fromEntries(kept))
}

/**
 * The conversation a pending request belongs to.
 *
 * The upstream keeps the pending requests of a working directory with the
 * working directory, so the answer is in that directory's list. When the
 * lookup does not produce an answer, nothing is claimed: the upstream
 * itself refuses a request it does not know, and refusing here as well
 * would only turn a working button into a broken one.
 */
async function requestConversationId(
  openCodeClient: OpenCodeClient,
  kind: 'permission' | 'question',
  requestId: string,
  directory: string | null,
): Promise<string | null> {
  try {
    const pending = await openCodeClient.getJson<unknown[]>(
      `/${kind}`,
      { directory: directory ?? undefined },
    )
    if (!Array.isArray(pending)) return null
    for (const item of pending) {
      const id = (item as { id?: unknown })?.id
      if (id === requestId) return requestSessionIdOf(item)
    }
    return null
  } catch {
    return null
  }
}

export function createAuthenticatedOpenCodeProxyRoutes(
  openCodeClient: OpenCodeClient,
  requireAuth: MiddlewareHandler,
  database: Database,
): Hono {
  const app = new Hono()

  app.all('/*', requireAuth, async (c) => {
    if (!opencodeServerManager.isLifecycleInitialized()) {
      return c.json({ error: 'OpenCode lifecycle initialization is incomplete; refusing to proxy to an unmanaged server' }, 503)
    }

    const directory = c.req.query('directory')
    const principal = principalFrom(
      (c as unknown as { get: (key: string) => Session['user'] | undefined }).get('user'),
    )
    const requestPath = new URL(c.req.url).pathname

    // Only the provider listing, only reads, only successful reads - and only
    // after the access check below has had its say.
    const isProviderList = c.req.method === 'GET' && requestPath.endsWith('/provider')
    // No username means no safe key: sharing one bucket between callers
    // we could not identify would hand one tenant another's connected list.
    // Such a request is simply not cached.
    const cacheKey = isProviderList && principal?.username
      ? `${principal.username}|${c.req.url}`
      : null

    const roots = principal ? resolveAccessRoots(database, principal) : []
    const isAdmin = principalIsAdmin(principal)

    /**
     * The route the request falls under, and what has to be true of it.
     *
     * An administrator runs this server and keeps the whole API. Everybody
     * else gets the list, and the list is short on purpose.
     */
    let scope: ProxyScope = 'reading'
    if (!isAdmin) {
      const upstreamPath = upstreamPathFrom(requestPath.slice(PROXY_PREFIX.length))
      const route = upstreamPath ? matchProxyRoute(c.req.method, upstreamPath) : null
      if (!route) {
        logger.warn(`Blocked an OpenCode proxy request that is not on the list: ${c.req.method} ${requestPath}`)
        return c.json({ error: 'Forbidden' }, 403)
      }
      scope = route.scope
    }

    // A directory is the caller's to name only if it is one of theirs. This
    // holds for a caller we could not identify as well: with no identity
    // there are no directories to speak of, so a request that names one is
    // refused rather than allowed on the strength of not knowing.
    if (!isAdmin && directory && !isWithinRoots(directory, roots)) {
      logger.warn(`Blocked cross-tenant OpenCode proxy access to directory: ${directory}`)
      return c.json({ error: 'Forbidden' }, 403)
    }

    // A change lands in a working directory. Without one it lands in the
    // directory the server itself was started in, which belongs to nobody
    // in particular and to everybody at once.
    if (scope === 'writing' && !isAdmin && !directory) {
      logger.warn(`Blocked an OpenCode proxy write without a working directory: ${c.req.method} ${requestPath}`)
      return c.json({ error: 'Forbidden' }, 403)
    }

    const resolveDirectory = (sessionId: string) =>
      sessionDirectoryFromUpstream(openCodeClient, sessionId, directory ?? null)

    // A request that names a conversation may only touch the caller's own.
    //
    // The directory check above is about the *request*; this is about the
    // *conversation*. OpenCode files a conversation under a project, and a
    // project is identified by the git origin of the checkout - so two
    // people who cloned the same repository share one project, and one
    // person's conversation can be read, renamed, deleted or driven from
    // the other person's session.
    const upstreamPath = upstreamPathFrom(requestPath.slice(PROXY_PREFIX.length))
    const sessionId = upstreamPath ? sessionIdFromUpstreamPath(upstreamPath) : null
    if (scope === 'conversation' && sessionId && principal && !isAdmin) {
      const record = findAgentSession(database, sessionId)
      const allowed = await sessionBelongsToCaller(sessionId, record, principal, roots, resolveDirectory)
      if (!allowed) {
        logger.warn(
          `Blocked cross-tenant OpenCode proxy access to session ${sessionId} ` +
          `(owned by ${record?.username ?? record?.userId ?? 'nobody'})`,
        )
        return c.json({ error: 'Forbidden' }, 403)
      }
    }

    // A pending permission or question belongs to a conversation, so the
    // conversation decides - not the id, which is a bare token.
    const pendingRequest = upstreamPath ? requestIdFromUpstreamPath(upstreamPath) : null
    if (scope === 'request' && pendingRequest && principal && !isAdmin) {
      const conversationId = await requestConversationId(
        openCodeClient,
        pendingRequest.kind,
        pendingRequest.id,
        directory ?? null,
      )
      if (conversationId) {
        const record = findAgentSession(database, conversationId)
        const allowed = await sessionBelongsToCaller(
          conversationId,
          record,
          principal,
          roots,
          resolveDirectory,
        )
        if (!allowed) {
          logger.warn(
            `Blocked cross-tenant OpenCode proxy access to ${pendingRequest.kind} ` +
            `${pendingRequest.id} (belongs to conversation ${conversationId})`,
          )
          return c.json({ error: 'Forbidden' }, 403)
        }
      }
    }

    if (cacheKey) {
      const cached = readCachedProviderList(cacheKey)
      if (cached) return cached
    }

    const response = await openCodeClient.forwardRaw(c.req.raw)

    // The session list is scoped to a project, not to a person, so what
    // comes back has to be narrowed to the caller's own conversations
    // before it leaves the server. The upstream's own directory filter
    // cannot do this: the two checkouts of one repository are different
    // directories and the same project.
    if (
      c.req.method === 'GET' &&
      scope === 'listing' &&
      response.status === 200 &&
      principal
    ) {
      const filtered = await filterSessionListResponse(response, database, principal, roots)
      if (filtered) return filtered
    }

    // The pending requests and the state of the conversations are answers
    // about conversations too, so they are narrowed the same way.
    if (c.req.method === 'GET' && response.status === 200 && principal && !isAdmin) {
      if (upstreamPath === '/session/status') {
        const filtered = await filterStatusMapResponse(response, database, principal)
        if (filtered) return filtered
      } else if (upstreamPath === '/permission' || upstreamPath === '/question') {
        const filtered = await filterRequestListResponse(response, database, principal)
        if (filtered) return filtered
      }
    }

    if (cacheKey && response.status === 200) {
      try {
        const body = await response.clone().arrayBuffer()
        rememberProviderList(cacheKey, response, body)
      } catch {
        // A body we could not copy is simply not cached.
      }
    }

    if (response.status === 200 && isSessionCreation(c.req.method, requestPath)) {
      await recordCreatedSession(database, response, principal, directory ?? null)
    }

    return response
  })

  return app
}
