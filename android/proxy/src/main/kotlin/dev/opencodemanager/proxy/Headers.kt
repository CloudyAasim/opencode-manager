package dev.opencodemanager.proxy

import java.net.URI

/**
 * Header rewriting. The Kotlin twin of `desktop/src/proxy-headers.ts`, kept
 * deliberately close to it so a fix in one is obviously a fix in the other.
 */

/** Headers that describe a single hop and must not be forwarded.
 *
 * RFC 9110 7.6.1. `transfer-encoding` in particular is not merely useless here -
 * forwarding a `chunked` request header alongside a body that is already being
 * framed produces a request the upstream cannot parse.
 */
private val HOP_BY_HOP = setOf(
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
)

/**
 * `scheme://host`, with a non-default port kept and a default one left off, so
 * an origin compared against a browser's never differs only by spelling.
 */
class TargetOrigin(val scheme: String, val host: String, val port: Int) {
    val origin: String get() = "$scheme://$host"
}

fun targetOrigin(target: ServerAddress): TargetOrigin {
    val default = defaultPortFor(target.scheme)
    val host = if (target.port == default) target.host else "${target.host}:${target.port}"
    return TargetOrigin(target.scheme, host, target.port)
}

/**
 * Turn a browser request into one the upstream would accept if the browser had
 * gone there directly.
 *
 * The origin rewrite is the whole point of this proxy existing. The app is served
 * from `http://127.0.0.1:<port>`, so from the WebView's point of view every
 * request is same-origin and CORS never applies - but the upstream still sees
 * `Origin: http://127.0.0.1:<port>` on every POST, and it has two independent
 * checks that will refuse it:
 *
 *  - the CORS layer, which returns no `access-control-allow-origin` for an origin
 *    outside `AUTH.TRUSTED_ORIGINS`;
 *  - better-auth's own `trustedOrigins`, which rejects the request outright.
 *
 * Rewriting to the upstream's own origin makes the server see exactly what it
 * would have seen without a proxy in between. Not rewriting it is not "a missing
 * CORS header the browser ignores" - the browser is not the one that has to be
 * satisfied here, and `same-origin` in the browser buys the user nothing if the
 * server refuses the request.
 */
fun buildUpstreamHeaders(headers: Map<String, List<String>>, target: TargetOrigin): Map<String, List<String>> {
    val out = LinkedHashMap<String, List<String>>()
    for ((rawName, values) in headers) {
        val name = rawName.lowercase()
        if (values.isEmpty()) continue
        if (name in HOP_BY_HOP) continue

        when (name) {
            "host" -> out["host"] = listOf(target.host)
            // A literal `Origin: null` from a sandboxed document is replaced with
            // the upstream's own origin for the same reason a real one is: the
            // upstream's origin checks would reject `null` outright.
            "origin" -> out["origin"] = listOf(target.origin)
            // Referer keeps its path and query, because some handlers read it and
            // a bare origin would name a different URL than the one in the bar.
            "referer" -> out["referer"] = listOf(rewriteReferer(values.joinToString(","), target.origin))
            else -> out[name] = values
        }
    }
    return out
}

fun rewriteReferer(referer: String, targetOrigin: String): String {
    // `null` means the browser suppressed it by policy. Passing that through as a
    // literal string would be worse than dropping it.
    if (referer.isEmpty() || referer == "null") return targetOrigin
    return try {
        val parsed = URI(referer)
        // A referer is always absolute. A relative one cannot be rewritten - there
        // is no origin to replace - and silently appending its path to the target
        // would invent a URL nobody asked for, so it degrades to the bare origin.
        if (parsed.scheme.isNullOrEmpty() || parseAuthority(parsed.rawAuthority) == null) {
            return targetOrigin
        }
        targetOrigin + (parsed.rawPath ?: "/") + (parsed.rawQuery?.let { "?$it" } ?: "")
    } catch (_: Exception) {
        targetOrigin
    }
}

/**
 * Make a cookie the browser will accept on *this* origin.
 *
 * `Domain` has to go regardless: a cookie scoped to the upstream's domain is
 * rejected outright when served from loopback, and the browser logs it rather
 * than reporting it anywhere the app can see.
 *
 * `Secure` is dropped only when this side of the proxy is plain http. The proxy
 * binds to loopback, so the flag would assert a protection that is not there
 * while breaking a cookie that has to work. Over https it is left alone, and
 * leaving it alone matters - stripping it there would quietly downgrade the
 * cookie for a real remote session.
 */
fun rewriteSetCookie(cookies: List<String>, secureTransport: Boolean): List<String> = cookies.map { cookie ->
    cookie.split(';')
        .filter { part ->
            val attribute = part.substringBefore('=').trim().lowercase()
            if (attribute == "domain") return@filter false
            if (attribute == "secure" && !secureTransport) return@filter false
            true
        }
        .joinToString(";")
}

private val CSP_DIRECTIVES_WITH_URLS = setOf("connect-src", "form-action", "frame-ancestors")

fun rewriteCsp(csp: String): String = csp
    .split(';')
    .map { it.trim() }
    .filter { it.isNotEmpty() }
    .joinToString("; ") { directive ->
        // A CSP that pins connect-src to the upstream origin would block the very
        // requests this proxy exists to carry, so the whole source list is
        // replaced rather than merely appended to.
        val name = directive.substringBefore(' ').substringBefore('\t').lowercase()
        if (name in CSP_DIRECTIVES_WITH_URLS) "$name 'self'" else directive
    }

/**
 * A redirect to the upstream's absolute origin would take the user off the proxy
 * origin and straight back into the cross-origin case this exists to avoid, so
 * only the path survives.
 *
 * KNOWN GAP, identical in `desktop/src/proxy-headers.ts`: a protocol-relative
 * `//elsewhere.example/x` starts with `/` and is returned verbatim, so the
 * WebView follows it to another origin. Assessed as low severity - the header
 * can only come from the upstream the user already chose, and the session cookie
 * is scoped to loopback so it does not travel. Left in place so the two
 * implementations stay identical; fix both together or neither.
 */
fun rewriteLocation(location: String): String {
    if (location.startsWith("/")) return location
    return try {
        val parsed = URI(location)
        if (parsed.scheme.isNullOrEmpty() && parseAuthority(parsed.rawAuthority) == null) {
            // Relative and already origin-relative: nothing to strip.
            return location
        }
        (parsed.rawPath ?: "/") +
            (parsed.rawQuery?.let { "?$it" } ?: "") +
            (parsed.rawFragment?.let { "#$it" } ?: "")
    } catch (_: Exception) {
        location
    }
}

/** Response headers worth passing back, minus the hop-by-hop set.
 *
 *  Mutable because the caller also removes `content-length` and
 *  `transfer-encoding` from it: those two are consumed by the framing on the way
 *  out and must not be forwarded alongside it. */
fun buildDownstreamHeaders(
    headers: Map<String, List<String>>,
    target: TargetOrigin,
    secureTransport: Boolean,
): LinkedHashMap<String, List<String>> {
    val out = LinkedHashMap<String, List<String>>()
    for ((rawName, values) in headers) {
        val name = rawName.lowercase()
        if (values.isEmpty()) continue
        if (name in HOP_BY_HOP) continue

        when (name) {
            "set-cookie" -> out[name] = rewriteSetCookie(values, secureTransport)
            "location" -> out[name] = listOf(rewriteLocation(values.first()))
            "content-security-policy" -> out[name] = listOf(rewriteCsp(values.first()))
            else -> out[name] = values
        }
    }
    return out
}