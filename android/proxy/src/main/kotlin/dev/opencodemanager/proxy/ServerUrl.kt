package dev.opencodemanager.proxy

import java.net.URI

/**
 * The Kotlin twin of `shared/src/utils/server-url.ts` and the target parsing at
 * the top of `desktop/src/proxy.ts`. Kept close on purpose: an installed client
 * that normalizes `code.example.com` one way on Android and another way on the
 * desktop would store a preference that matches itself on one platform and not
 * the other. `ServerUrlParityTest` checks that against a recording of what the
 * TypeScript actually returns.
 *
 * The authority is parsed here rather than taken from `java.net.URI`, because
 * `URI` and the WHATWG `URL` the browser build uses disagree in three ways that
 * all show up in real input:
 *
 *  - `URI.getHost()` returns `null` for a hostname containing an underscore,
 *    which `my_box.local:3000` on a home network certainly can;
 *  - `URI.getPort()` returns `-1` in exactly that case too, so the port is lost
 *    as well;
 *  - `URL` lowercases the host and drops a default port, `URI` does neither.
 *
 * The golden file records which of the two behaviours this client promises.
 */

/**
 * Trailing path segments that mean "this is an API call", not "this is the
 * server". Identical to the list in `shared/src/utils/server-url.ts` and
 * `backend/src/utils/discovery-cache.ts`; all three have to agree.
 */
private val API_RESOURCE_SEGMENTS = setOf("audio", "speech", "transcriptions", "models", "voices")
private val VERSION_SEGMENT = Regex("^v\\d+$", RegexOption.IGNORE_CASE)
private val HAS_SCHEME = Regex("^[a-z][a-z0-9+.-]*://", RegexOption.IGNORE_CASE)

/** `scheme:` followed by three or more slashes and a path - `https:///host/x`. */
private val SLASH_FOLDABLE = Regex("^([a-z][a-z0-9+.-]*):/{3,}(/.*)$", RegexOption.IGNORE_CASE)

private const val DEFAULT_HTTP_PORT = 80
private const val DEFAULT_HTTPS_PORT = 443

internal fun defaultPortFor(scheme: String): Int = if (scheme == "https") DEFAULT_HTTPS_PORT else DEFAULT_HTTP_PORT

/** Same job as Node's `.replace(/\/+$/, '')`. */
private fun stripTrailingSlashes(value: String): String {
    var end = value.length
    while (end > 0 && value[end - 1] == '/') end--
    return value.substring(0, end)
}

/** A hostname, an explicitly written port if the address had one, and any
 *  credentials, which are carried but never used by this client. */
internal data class Authority(val userInfo: String?, val host: String, val port: Int?)

/**
 * Split `user:pass@host:port` into its parts.
 *
 * Returns null for anything that is not a plain host with an optional numeric
 * port. The numeric check matters: without it, `javascript:alert(1)` becomes a
 * URL whose "host" is `javascript` and whose "port" is `alert(1)`, and a pasted
 * link turns into a request to a host nobody named.
 */
internal fun parseAuthority(raw: String?): Authority? {
    if (raw.isNullOrEmpty()) return null
    if (raw.any { it.isWhitespace() || it == '/' || it == '?' || it == '#' }) return null

    // `a@b` is userinfo plus host. `a@b@c` is neither, and dropping everything
    // before the last `@` would quietly turn it into a host nobody named.
    if (raw.count { it == '@' } > 1) return null
    val at = raw.indexOf('@')
    val userInfo = if (at < 0) null else raw.substring(0, at).ifEmpty { return null }
    val afterUserInfo = if (at < 0) raw else raw.substring(at + 1)
    if (afterUserInfo.isEmpty()) return null

    val host: String
    var rest: String
    if (afterUserInfo.startsWith("[")) {
        val close = afterUserInfo.indexOf(']')
        if (close < 0) return null
        host = afterUserInfo.substring(0, close + 1)
        rest = afterUserInfo.substring(close + 1)
    } else {
        val colon = afterUserInfo.indexOf(':')
        if (colon < 0) {
            host = afterUserInfo
            rest = ""
        } else {
            host = afterUserInfo.substring(0, colon)
            rest = afterUserInfo.substring(colon)
        }
    }
    if (host.isEmpty()) return null

    if (rest.isEmpty() || rest == ":") return Authority(userInfo, host, null)
    if (!rest.startsWith(":")) return null
    // `toIntOrNull` is the whole validation: it rejects a non-numeric port, an
    // empty one and one out of range, which is exactly why `javascript:alert(1)`
    // does not become a URL with a host called `javascript`.
    val port = rest.substring(1).toIntOrNull() ?: return null
    if (port !in 1..65535) return null
    return Authority(userInfo, host, port)
}

/**
 * `https:///just/a/path` - which is what a paste of `/just/a/path` becomes once
 * the scheme is added. `URL` treats the slashes as an empty authority and then
 * reads the first path segment as the host, giving `https://just/a/path`. Left
 * unfolded this comes back as the input, which is neither a URL nor something
 * the person can act on. Only ever applied to a scheme this function added.
 */
private fun foldEmptyAuthority(candidate: String): String {
    val schemeEnd = candidate.indexOf(':')
    if (schemeEnd <= 0) return candidate
    var index = schemeEnd + 1
    val slashes = candidate.length - index
    while (index < candidate.length && candidate[index] == '/') index++
    if (index - (schemeEnd + 1) < 2) return candidate

    val remainder = candidate.substring(index)
    val hostEnd = remainder.indexOfFirst { it == '/' || it == '?' || it == '#' }
    val host = if (hostEnd < 0) remainder else remainder.substring(0, hostEnd)
    if (host.isEmpty()) return candidate
    val tail = if (hostEnd < 0) "/" else remainder.substring(hostEnd)
    return candidate.substring(0, schemeEnd + 1) + "//" + host + tail
}

/**
 * Reduce any spelling of a server address to a base that can be concatenated with
 * an absolute path like `/api/health`.
 *
 * Never throws, exactly like the TypeScript original: a malformed address must
 * not take the app down at startup, it has to surface as a rejected connection
 * the person can fix. Anything unparseable comes back trimmed and unchanged, so
 * the error names what they typed rather than an empty string.
 */
fun normalizeServerUrl(input: String?): String {
    val trimmed = (input ?: "").trim()
    if (trimmed.isEmpty()) return ""

    // A bare host with no scheme is the most common paste. `URI` rejects it, so
    // the scheme is added to parse with and then taken back off the result:
    // `https://x` must not silently become the base for an `http://` server
    // someone is running locally.
    val hadScheme = HAS_SCHEME.containsMatchIn(trimmed)
    var candidate = if (hadScheme) trimmed else "https://$trimmed"

    // Only for the scheme this function just added.
    if (!hadScheme) candidate = foldEmptyAuthority(candidate)

    val parsed = try {
        URI(candidate)
    } catch (_: Exception) {
        return stripTrailingSlashes(trimmed)
    }

    val scheme = parsed.scheme?.lowercase()
    if (scheme != "http" && scheme != "https") {
        // Not something this client can talk to; leave it visible rather than
        // quietly turning it into a relative path.
        return stripTrailingSlashes(trimmed)
    }

    val authority = parseAuthority(parsed.rawAuthority) ?: return stripTrailingSlashes(trimmed)

    val segments = (parsed.rawPath ?: "").split('/').filter { it.isNotEmpty() }.toMutableList()
    while (segments.isNotEmpty()) {
        val last = segments[segments.size - 1].lowercase()
        if (last in API_RESOURCE_SEGMENTS || VERSION_SEGMENT.matches(last)) {
            segments.removeAt(segments.size - 1)
            continue
        }
        break
    }

    // A leading `api` is this application's own route prefix. Left in place it
    // would turn the next call into `.../api/health/api/health`. Only a leading
    // `api` counts, so a mount whose name merely begins with the word is
    // untouched.
    if (segments.isNotEmpty() && segments[0].lowercase() == "api") {
        segments.clear()
    }

    // `URL` lowercases the host and leaves out a default port, and an origin
    // compared against a browser's must not differ from it only by spelling.
    // Credentials are carried because `URL` carries them; [toUpstreamUrl] is
    // where they are refused, since a proxy cannot use them.
    val host = authority.host.lowercase()
    val port = authority.port
    val authorityText = buildString {
        if (authority.userInfo != null) append(authority.userInfo).append('@')
        append(host)
        if (port != null && port != defaultPortFor(scheme)) append(':').append(port)
    }

    // A bare `/` carries no information and would turn `/api/health` into
    // `//api/health`.
    return if (segments.isEmpty()) "$scheme://$authorityText" else "$scheme://$authorityText/${segments.joinToString("/")}"
}

/** Join a base and an absolute path with exactly one slash between them. */
fun joinServerUrl(base: String, path: String): String {
    val cleanBase = base.trimEnd('/')
    val cleanPath = if (path.startsWith("/")) path else "/$path"
    return cleanBase + cleanPath
}

class InvalidTargetError(val input: String, reason: String) :
    IllegalArgumentException("$reason: \"$input\"")

/** A validated upstream: scheme, host, port and the sub-path it is mounted at. */
data class ServerAddress(
    val scheme: String,
    val host: String,
    val port: Int,
    val path: String,
) {
    /** Host with a non-default port spelled out, exactly as it is sent. */
    val authority: String get() = if (port == defaultPortFor(scheme)) host else "$host:$port"

    /** `scheme://host[:port]`, which is also `path`-free: the origin. */
    val origin: String get() = "$scheme://$authority"

    /** `origin` plus the sub-path the server is mounted at. */
    val base: String get() = origin + path

    /** The same server, with a request target applied to the mounted path. */
    fun withPath(requestTarget: String): ServerAddress =
        copy(path = joinServerUrl(path, requestTarget.substringBefore('?')))
}

/**
 * `normalizeServerUrl` deliberately never throws, but it hands back the input
 * trimmed and unchanged when it cannot parse it, which is fine for a browser
 * ("same origin") and meaningless here. This proxy has to go somewhere; an
 * unparseable target left to fail on the first request turns a typo into a
 * connection error reported as "the app is broken" rather than "the address is
 * wrong". So it fails here, at construction, with the reason attached.
 */
fun toUpstreamUrl(input: String): ServerAddress {
    val normalized = normalizeServerUrl(input)
    if (normalized.isEmpty()) {
        throw InvalidTargetError(input, "no server address was given")
    }
    val parsed = try {
        URI(normalized)
    } catch (_: Exception) {
        throw InvalidTargetError(input, "not an absolute http(s) address")
    }
    val scheme = parsed.scheme?.lowercase()
    if (scheme != "http" && scheme != "https") {
        throw InvalidTargetError(input, "unsupported scheme ${parsed.scheme}")
    }
    val authority = parseAuthority(parsed.rawAuthority)
        ?: throw InvalidTargetError(input, "not an absolute http(s) address")
    if (authority.userInfo != null) {
        // The browser build keeps these, so this client does too; but this proxy
        // has no way to use them, and silently connecting as anonymous would look
        // like a rejected password rather than an unsupported feature.
        throw InvalidTargetError(input, "a server address with a username or password is not supported")
    }
    val port = authority.port ?: defaultPortFor(scheme)
    val path = stripTrailingSlashes(parsed.rawPath ?: "")
    return ServerAddress(scheme, authority.host.lowercase(), port, path)
}