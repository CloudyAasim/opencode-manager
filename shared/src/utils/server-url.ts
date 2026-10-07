/**
 * Which server this client talks to.
 *
 * The answer used to be baked in at build time (`VITE_API_URL`), which is fine
 * for exactly one deployment and wrong for both of the situations this has to
 * survive: a self-hoster builds the bundle once and points it at their own
 * domain, and an installed client follows its user to whichever server they
 * name. So the base URL is resolved at runtime, from four sources in a fixed
 * order, and the empty string still means "the origin I was served from" - the
 * behaviour every existing deployment depends on.
 *
 * Normalisation is separate from resolution on purpose. A user pasting a server
 * address types `code.aasim.l.cd`, or `https://code.aasim.l.cd/`, or a whole
 * endpoint somebody copied out of the address bar; all three name one server,
 * and all three have to reduce to the same string or the stored preference
 * stops matching itself on the next launch.
 */

/** What a client knows about the server it should use. All parts optional. */
export interface ServerUrlSources {
  /** What the person chose in the UI and saved. Highest priority. */
  userSelected?: string | null
  /** A `config.json` shipped next to the bundle, for self-hosters to edit. */
  fromConfigFile?: string | null
  /** Compile-time default; `VITE_API_URL` in the browser builds. */
  fromBuild?: string | null
}

/**
 * Trailing path segments that mean "this is an API call", not "this is the
 * server". A person picks a server by pasting whatever they had to hand - and
 * the address most likely to be on screen is a full endpoint copied out of a
 * config panel. Kept deliberately identical to the list in
 * `backend/src/utils/discovery-cache.ts` for the same reason; unify the two
 * when that module moves into `shared` rather than letting them drift.
 */
const API_RESOURCE_SEGMENTS = new Set(['audio', 'speech', 'transcriptions', 'models', 'voices'])
const VERSION_SEGMENT = /^v\d+$/i

/**
 * Reduce any spelling of a server address to a base that can be concatenated
 * with an absolute path like `/api/health`.
 *
 * Returns `''` - same origin - for anything empty, and throws nothing: a
 * malformed address must not take the app down at startup, it has to surface as
 * a rejected connection the person can fix. That is why a non-absolute string is
 * handed back trimmed rather than parsed.
 */
export function normalizeServerUrl(input: string | null | undefined): string {
  const trimmed = (input ?? '').trim()
  if (!trimmed) return ''

  // A bare host with no scheme is the single most common paste. `new URL`
  // rejects it, so the scheme is added, parsed, and then removed again from the
  // result - `https://x` must not silently become the base for an `http://`
  // server the operator is running locally.
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return trimmed.replace(/\/+$/, '')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    // Not something this client can talk to; leave it visible rather than
    // quietly turning it into a relative path against the current origin.
    return trimmed.replace(/\/+$/, '')
  }

  // A query or fragment cannot be concatenated with a path.
  url.search = ''
  url.hash = ''

  const segments = url.pathname.split('/').filter(Boolean)
  while (segments.length > 0) {
    const last = segments.at(-1)
    if (last === undefined) break
    if (API_RESOURCE_SEGMENTS.has(last.toLowerCase()) || VERSION_SEGMENT.test(last)) {
      segments.pop()
      continue
    }
    break
  }

  // A leading `api` is this application's own route prefix, and a pasted
  // address is as likely to be `https://host/api/health` as it is to be an
  // upstream endpoint. Left in place it would turn the next call into
  // `.../api/health/api/health`. Only a leading `api` counts, so a mount whose
  // name merely begins with the word - `api-manager` - is untouched. The cost is
  // a server genuinely mounted at `/api`, which the settings screen shows
  // resolved before it is saved.
  if (segments[0]?.toLowerCase() === 'api') {
    segments.length = 0
  }

  // A server may be mounted under a sub-path (`https://host/opencode-manager`),
  // so the path is kept - but a bare `/` carries no information and would turn
  // `/api/health` into `//api/health`.
  url.pathname = segments.length > 0 ? `/${segments.join('/')}` : '/'

  return url.toString().replace(/\/$/, '')
}

/**
 * The base URL every API call is built on.
 *
 * Priority is the one thing here that is easy to get wrong in a way no test
 * would catch until a self-hoster's app quietly pointed back at someone else's
 * server: what a person explicitly chose beats what a file in the bundle says,
 * and both beat the compile-time default. An unset preference must fall through
 * rather than pin the first-run value forever.
 */
export function resolveServerUrl(sources: ServerUrlSources): string {
  const candidates = [sources.userSelected, sources.fromConfigFile, sources.fromBuild]

  for (const candidate of candidates) {
    const normalized = normalizeServerUrl(candidate)
    if (normalized) return normalized
  }

  // Same origin. This is what a deployment behind its own nginx serves today,
  // and it is the reason the session cookie stays first-party.
  return ''
}

/**
 * Whether the client can rely on its own origin for cookies.
 *
 * Only a same-origin client is guaranteed to have its session cookie attached
 * to every request: better-auth issues `SameSite=Lax`, and a cross-site fetch
 * does not carry it. So an installed client talking to a remote server needs a
 * same-origin proxy in front, and this is the predicate that says so.
 */
export function isSameOriginServer(sources: ServerUrlSources, pageOrigin?: string): boolean {
  const base = resolveServerUrl(sources)
  if (!base) return true
  if (!pageOrigin) return false

  try {
    return new URL(base).origin === new URL(pageOrigin).origin
  } catch {
    return false
  }
}

/** Join a base and an absolute path with exactly one slash between them. */
export function joinServerUrl(base: string, path: string): string {
  const cleanBase = base.replace(/\/+$/, '')
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${cleanBase}${cleanPath}`
}