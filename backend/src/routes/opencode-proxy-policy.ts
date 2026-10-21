/**
 * What the browser is allowed to ask the OpenCode server for.
 *
 * The route in front of OpenCode used to be a pass-through: whatever the
 * browser asked for went upstream. That is only as private as the least
 * careful endpoint behind it, and OpenCode's API has plenty of endpoints
 * that are about *the server* rather than about one working directory:
 *
 * - `PATCH /global/config` writes the one configuration document that every
 *   session on this host reads. The manager already treats that document as
 *   administrator-only (`/api/settings/opencode-config` is behind
 *   `requireAdmin`), and it writes an audit row for every change. A
 *   pass-through route lets any signed-in person rewrite it instead - and
 *   put a local MCP server in it, which is a command to run on this host.
 * - `POST /global/dispose` throws the whole server away, `POST
 *   /global/upgrade` replaces the binary, `GET /global/event` is every
 *   conversation on the host in one stream.
 * - `PUT /auth/<provider>` is the credential store everybody shares.
 * - `POST /pty` is a shell that is not the manager's terminal, so it is not
 *   covered by the terminal's own rules.
 *
 * So the browser side is a list of what a person may ask for, and everything
 * that is not on the list is refused. The administrator keeps the whole API:
 * the administrator is the one who runs this server.
 *
 * The list is written from the calls the interface actually makes, not from
 * the shape of OpenCode's API. A route that the interface does not use is a
 * route nobody has thought about, and an endpoint that nobody has thought
 * about is exactly where a mistake hides.
 */

/**
 * What the proxy has to know about a request before it forwards it.
 *
 * - `listing`: an answer about conversations. The answer is narrowed to the
 *   caller's own before it leaves the server.
 * - `conversation`: the request names one conversation. The ledger decides
 *   who owns it.
 * - `request`: the request names a pending permission or question. Those
 *   belong to a conversation, so the conversation decides.
 * - `reading`: a read that is about one working directory.
 * - `writing`: a change that lands in one working directory, so the caller
 *   has to name a directory of their own.
 */
export type ProxyScope = 'listing' | 'conversation' | 'request' | 'reading' | 'writing'

export interface ProxyRoute {
  readonly method: string
  readonly path: RegExp
  readonly scope: ProxyScope
}

/**
 * The paths under a session root, and what may be done to them.
 *
 * `/session` and `/api/session` are the same conversation API in two
 * spellings: the interface reads the list from the second one and the
 * messages from the first one. Both have to be covered, or the narrow one
 * is simply a door around the wide one.
 */
const CONVERSATION_ACTIONS: readonly { method: string; suffix: string }[] = [
  { method: 'GET', suffix: '' },
  { method: 'PATCH', suffix: '' },
  { method: 'DELETE', suffix: '' },
  { method: 'GET', suffix: '/message' },
  { method: 'POST', suffix: '/message' },
  { method: 'POST', suffix: '/prompt_async' },
  { method: 'POST', suffix: '/fork' },
  { method: 'POST', suffix: '/abort' },
  { method: 'POST', suffix: '/command' },
  { method: 'POST', suffix: '/shell' },
  { method: 'POST', suffix: '/summarize' },
  { method: 'POST', suffix: '/revert' },
  { method: 'POST', suffix: '/unrevert' },
]

function conversationRoutes(root: string): ProxyRoute[] {
  return CONVERSATION_ACTIONS.map((action) => ({
    method: action.method,
    path: new RegExp(`^${root}/[^/]+${action.suffix}$`),
    scope: 'conversation' as const,
  }))
}

/**
 * The routes a signed-in person may use.
 *
 * The order matters: `/session/status` is a fixed path that would otherwise
 * be read as a conversation called "status".
 */
export const BROWSER_PROXY_ROUTES: readonly ProxyRoute[] = [
  // Lists of conversations. The answer is narrowed to the caller's own.
  { method: 'GET', path: /^\/session$/, scope: 'listing' },
  { method: 'GET', path: /^\/api\/session$/, scope: 'listing' },

  // Fixed paths under the session root, before the conversation rules.
  { method: 'GET', path: /^\/session\/status$/, scope: 'reading' },

  ...conversationRoutes('/session'),
  ...conversationRoutes('/api/session'),

  // A pending permission or a pending question. Both belong to a
  // conversation, so the conversation is what decides.
  { method: 'POST', path: /^\/permission\/[^/]+\/reply$/, scope: 'request' },
  { method: 'POST', path: /^\/question\/[^/]+\/reply$/, scope: 'request' },
  { method: 'POST', path: /^\/question\/[^/]+\/reject$/, scope: 'request' },

  // Reads. When a directory is named it has to be one of the caller's own;
  // without one, the answer is about the server itself.
  { method: 'GET', path: /^\/config$/, scope: 'reading' },
  { method: 'GET', path: /^\/config\/providers$/, scope: 'reading' },
  { method: 'GET', path: /^\/provider$/, scope: 'reading' },
  { method: 'GET', path: /^\/command$/, scope: 'reading' },
  { method: 'GET', path: /^\/agent$/, scope: 'reading' },
  { method: 'GET', path: /^\/permission$/, scope: 'reading' },
  { method: 'GET', path: /^\/question$/, scope: 'reading' },
  { method: 'GET', path: /^\/mcp$/, scope: 'reading' },

  // Changes. These land in a working directory, so the caller has to name
  // one of their own for the change to land somewhere it belongs to them.
  { method: 'POST', path: /^\/session$/, scope: 'writing' },
  { method: 'POST', path: /^\/api\/session$/, scope: 'writing' },
  { method: 'PATCH', path: /^\/config$/, scope: 'writing' },
  // The one MCP call the interface makes outside the administrator's
  // settings: finishing an OAuth flow for a server in one repository.
  { method: 'POST', path: /^\/mcp\/[^/]+\/auth\/callback$/, scope: 'writing' },
  { method: 'DELETE', path: /^\/experimental\/workspace\/[^/]+$/, scope: 'writing' },
]

/**
 * The route a request falls under, or null when nothing allows it.
 *
 * A path that matches no route is refused. That is the point of the list:
 * the endpoints nobody has thought about - `/global/config`, `/pty`,
 * `/auth/<provider>`, `/global/dispose` - are refused rather than passed on
 * because they happened to be there.
 */
export function matchProxyRoute(method: string, path: string): ProxyRoute | null {
  const wanted = method.toUpperCase()
  for (const route of BROWSER_PROXY_ROUTES) {
    if (route.method !== wanted) continue
    if (!route.path.test(path)) continue
    return route
  }
  return null
}

/** The conversation a path names, in either spelling of the API. */
export function sessionIdFromUpstreamPath(path: string): string | null {
  const match = /^\/(?:api\/)?session\/([^/?]+)/.exec(path)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

/** The pending request a path names: a permission or a question. */
export function requestIdFromUpstreamPath(
  path: string,
): { kind: 'permission' | 'question'; id: string } | null {
  const match = /^\/(permission|question)\/([^/?]+)\/(?:reply|reject)$/.exec(path)
  if (!match?.[1] || !match[2]) return null
  const kind = match[1] === 'permission' ? 'permission' : 'question'
  try {
    return { kind, id: decodeURIComponent(match[2]) }
  } catch {
    return { kind, id: match[2] }
  }
}

/**
 * The path upstream sees, with the encoding undone.
 *
 * The encoding has to be undone before the list is consulted, because
 * `%70ty` is `/pty` and a list that only matched the readable spelling
 * would be walked straight through. A path that tries to climb out of its
 * own directory is refused outright rather than normalised: the upstream
 * request would be normalised too, and then the two would no longer be
 * talking about the same path.
 */
export function upstreamPathFrom(rawPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return null
  }
  if (decoded.includes('..')) return null
  if (!decoded.startsWith('/')) return null
  return decoded.length > 1 ? decoded.replace(/\/+$/, '') : decoded
}
