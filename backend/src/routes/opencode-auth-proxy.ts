import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { Database } from 'bun:sqlite'
import { opencodeServerManager } from '../services/opencode-single-server'
import type { OpenCodeClient } from '../services/opencode/client'
import { principalFrom, principalIsAdmin, resolveAccessRoots } from '../auth/ownership'
import { isWithinRoots } from '../auth/access-scope'
import type { Session } from '../auth'
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

    // Only the provider listing, only reads, only successful reads - and only
    // after the access check below has had its say.
    const isProviderList =
      c.req.method === 'GET' && new URL(c.req.url).pathname.endsWith('/provider')
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

    return response
  })

  return app
}
