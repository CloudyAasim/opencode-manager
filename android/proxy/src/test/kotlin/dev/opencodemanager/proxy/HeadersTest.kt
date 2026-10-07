package dev.opencodemanager.proxy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Kotlin twin of `desktop/src/proxy-headers.test.ts`. */
class HeadersTest {
    private val target = targetOrigin(toUpstreamUrl("https://code.example.com"))
    private val lanTarget = targetOrigin(toUpstreamUrl("http://192.168.1.10:5551"))

    private fun headers(vararg pairs: Pair<String, String>): Map<String, List<String>> =
        pairs.toMap().mapValues { listOf(it.value) }

    @Test
    fun `hop-by-hop headers are dropped`() {
        val out = buildUpstreamHeaders(
            headers(
                "connection" to "keep-alive",
                "keep-alive" to "timeout=5",
                "transfer-encoding" to "chunked",
                "upgrade" to "websocket",
                "proxy-authorization" to "Basic abc",
                "trailer" to "x-thing",
                "te" to "trailers",
                "x-real-header" to "kept",
            ),
            target,
        )
        assertEquals(listOf("kept"), out["x-real-header"])
        for (dropped in listOf("connection", "keep-alive", "transfer-encoding", "upgrade",
            "proxy-authorization", "trailer", "te")) {
            assertFalse("$dropped must not be forwarded", out.containsKey(dropped))
        }
    }

    @Test
    fun `a chunked transfer-encoding would make the upstream request unparseable`() {
        // Forwarded alongside a body that is already framed, `transfer-encoding:
        // chunked` makes the upstream see two framings and give up.
        val out = buildUpstreamHeaders(headers("transfer-encoding" to "chunked"), target)
        assertTrue(out.isEmpty())
    }

    @Test
    fun `origin is rewritten to the upstream's own origin`() {
        // The whole reason this proxy exists: the upstream's CORS layer and
        // better-auth both check this, and neither is satisfied by loopback.
        val out = buildUpstreamHeaders(headers("origin" to "http://127.0.0.1:41234"), target)
        assertEquals(listOf("https://code.example.com"), out["origin"])
    }

    @Test
    fun `a sandboxed null origin is replaced too`() {
        val out = buildUpstreamHeaders(headers("origin" to "null"), target)
        assertEquals(listOf("https://code.example.com"), out["origin"])
    }

    @Test
    fun `origin keeps a non-default port`() {
        val out = buildUpstreamHeaders(headers("origin" to "http://127.0.0.1:41234"), lanTarget)
        assertEquals(listOf("http://192.168.1.10:5551"), out["origin"])
    }

    @Test
    fun `host names the upstream and keeps its port`() {
        // Dropping the port here would send `Host: 192.168.1.10` to a server
        // listening on 5551, which builds wrong absolute URLs and rejects
        // websocket upgrades.
        val out = buildUpstreamHeaders(headers("host" to "127.0.0.1:41234"), lanTarget)
        assertEquals(listOf("192.168.1.10:5551"), out["host"])
    }

    @Test
    fun `referer keeps its path and query`() {
        val out = buildUpstreamHeaders(headers("referer" to "http://127.0.0.1:41234/projects?tab=1"), target)
        assertEquals(listOf("https://code.example.com/projects?tab=1"), out["referer"])
    }

    @Test
    fun `a suppressed referer degrades to the bare origin`() {
        assertEquals(target.origin, rewriteReferer("null", target.origin))
        assertEquals(target.origin, rewriteReferer("", target.origin))
    }

    @Test
    fun `a relative referer is not invented into a URL`() {
        assertEquals(target.origin, rewriteReferer("/projects?tab=1", target.origin))
    }

    @Test
    fun `a repeated header keeps all its values`() {
        val out = buildUpstreamHeaders(mapOf("x-tag" to listOf("a", "b")), target)
        assertEquals(listOf("a", "b"), out["x-tag"])
    }

    @Test
    fun `an empty header value is dropped rather than sent blank`() {
        val out = buildUpstreamHeaders(mapOf("x-empty" to emptyList()), target)
        assertFalse(out.containsKey("x-empty"))
    }

    @Test
    fun `cookie domain is always removed`() {
        // A cookie scoped to the upstream's domain is rejected outright on
        // loopback, and the browser logs it rather than telling the app.
        val out = rewriteSetCookie(listOf("better-auth.session_token=abc; Domain=code.example.com; Path=/"), false)
        assertEquals("better-auth.session_token=abc; Path=/", out[0])
    }

    @Test
    fun `secure is dropped over loopback http and kept over https`() {
        val cookie = "better-auth.session_token=abc; Secure; HttpOnly; SameSite=Lax"
        assertEquals("better-auth.session_token=abc; HttpOnly; SameSite=Lax", rewriteSetCookie(listOf(cookie), false)[0])
        assertEquals(cookie, rewriteSetCookie(listOf(cookie), true)[0])
    }

    @Test
    fun `several cookies stay several`() {
        val out = rewriteSetCookie(listOf("a=1; Path=/", "b=2; Domain=x; Path=/"), false)
        assertEquals(2, out.size)
        assertEquals("b=2; Path=/", out[1])
    }

    @Test
    fun `a connect-src pinned to the upstream would block the proxy's own traffic`() {
        val out = rewriteCsp("default-src 'self'; connect-src https://code.example.com; img-src 'self' data:")
        assertEquals("default-src 'self'; connect-src 'self'; img-src 'self' data:", out)
    }

    @Test
    fun `other csp directives are left alone`() {
        val input = "default-src 'self'; script-src 'self' 'unsafe-inline'; frame-ancestors https://x.example"
        assertEquals("default-src 'self'; script-src 'self' 'unsafe-inline'; frame-ancestors 'self'", rewriteCsp(input))
    }

    @Test
    fun `an absolute redirect keeps only its path`() {
        // Following it would take the WebView off the proxy origin and straight
        // back into the cross-origin case this exists to avoid.
        assertEquals(
            "/login?next=/projects",
            rewriteLocation("https://code.example.com/login?next=/projects"),
        )
        assertEquals("/login#a", rewriteLocation("https://code.example.com/login#a"))
    }

    @Test
    fun `a path-relative redirect is untouched`() {
        assertEquals("/api/health", rewriteLocation("/api/health"))
        assertEquals("login", rewriteLocation("login"))
    }

    @Test
    fun `a downstream location is rewritten`() {
        val out = buildDownstreamHeaders(
            mapOf("location" to listOf("https://code.example.com/dashboard")),
            target,
            false,
        )
        assertEquals(listOf("/dashboard"), out["location"])
    }

    @Test
    fun `a downstream csp is rewritten`() {
        val out = buildDownstreamHeaders(
            mapOf("content-security-policy" to listOf("connect-src https://code.example.com")),
            target,
            false,
        )
        assertEquals(listOf("connect-src 'self'"), out["content-security-policy"])
    }

    @Test
    fun `a downstream set-cookie stays a list`() {
        // Joining several cookies onto one header line changes their meaning,
        // and the app has more than one.
        val out = buildDownstreamHeaders(
            mapOf("set-cookie" to listOf("a=1; Domain=code.example.com", "b=2; Domain=code.example.com")),
            target,
            false,
        )
        assertEquals(listOf("a=1", "b=2"), out["set-cookie"])
    }

    @Test
    fun `hop-by-hop response headers are dropped downstream too`() {
        val out = buildDownstreamHeaders(
            mapOf("transfer-encoding" to listOf("chunked"), "x-thing" to listOf("kept")),
            target,
            false,
        )
        assertFalse(out.containsKey("transfer-encoding"))
        assertEquals(listOf("kept"), out["x-thing"])
    }
}