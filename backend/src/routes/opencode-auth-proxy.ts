import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { Database } from 'bun:sqlite'
import { opencodeServerManager } from '../services/opencode-single-server'
import type { OpenCodeClient } from '../services/opencode/client'
import { principalFrom, principalIsAdmin, resolveAccessRoots } from '../auth/ownership'
import type { Principal } from '../auth/ownership'
import { isWithinRoots } from '../auth/access-scope'
import type { Session } from '../auth'
import { recordAgentSession } from '../services/agent-session'
import { getErrorMessage } from '../utils/error-utils'
import { logger } from '../utils/logger'

/**
 * The provider list is the answer to "what models can I pick", and it is the
 * same answer every time. Upstream rebuilds it from scratch on every call, so
 * opening the model picker waited on that work each time.
 *
 * Five minutes: long enough that the picker is warm for a sitting session,
 * short enough that a newly configured provider shows up without a restart.
 *
 * Keyed by user on purpose. `connected` in this payload reflects that user's
 * credentials, so a shared entry would show one tenant another's providers.
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
    if (cacheKey) {
      const cached = readCachedProviderList(cacheKey)
      if (cached) return cached
    }

    if (directory) {
      if (principal && !principalIsAdmin(principal)) {
        const roots = resolveAccessRoots(database, principal)
        if (!isWithinRoots(directory, roots)) {
          logger.warn(`Blocked cross-tenant OpenCode proxy access to directory: ${directory}`)
          return c.json({ error: 'Forbidden' }, 403)
        }
      }
    }

    const response = await openCodeClient.forwardRaw(c.req.raw)

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
