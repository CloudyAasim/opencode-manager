package dev.opencodemanager.proxy

import kotlin.io.bufferedReader
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * The Android client normalizes a server address the same way the browser, the
 * desktop client and `desktop/src/proxy.ts` do, because all four read the same
 * stored preference. If this class and `shared/src/utils/server-url.ts` disagree
 * about one input, a user who types that address gets a different server on
 * Android than everywhere else, with no error anywhere.
 *
 * `server-url-golden.tsv` is not a snapshot of what this implementation does -
 * it is a recording of what the TypeScript implementation actually returned, and
 * it is regenerated with `android/gen-server-url-cases.sh`.
 */
class ServerUrlParityTest {
    private fun unescape(field: String): String {
        val out = StringBuilder()
        var index = 0
        while (index < field.length) {
            val c = field[index]
            if (c == '\\' && index + 1 < field.length) {
                when (field[index + 1]) {
                    't' -> out.append('\t')
                    'r' -> out.append('\r')
                    'n' -> out.append('\n')
                    '\\' -> out.append('\\')
                    else -> fail("unknown escape in golden file: \\${field[index + 1]}")
                }
                index += 2
                continue
            }
            out.append(c)
            index++
        }
        return out.toString()
    }

    /** `Assert.fail` returns `Unit`, not `Nothing`, so an elvis over it widens to
     *  `Any` and every use of the result stops compiling. Throwing keeps the
     *  type. */
    private fun goldenText(): String {
        val stream = javaClass.classLoader!!.getResourceAsStream("server-url-golden.tsv")
        if (stream == null) {
            throw AssertionError(
                "server-url-golden.tsv is missing from the test resources; " +
                    "run android/gen-server-url-cases.sh to regenerate it"
            )
        }
        stream.use { return it.bufferedReader().readText() }
    }

    private fun goldenLines(): List<String> =
        goldenText().split("\n").filter { it.isNotBlank() && !it.startsWith("#") }

    @Test
    fun `normalization matches the recorded TypeScript answers`() {
        val failures = mutableListOf<String>()
        var checked = 0
        for (line in goldenLines()) {
            val fields = splitUnescapedTabs(line)
            if (fields.size != 2) continue // the join section has three columns
            val input = unescape(fields[0])
            val expected = unescape(fields[1])
            val actual = normalizeServerUrl(input)
            checked++
            if (actual != expected) {
                failures += "  normalize(${quoteForMessage(input)}) => ${quoteForMessage(actual)}," +
                    " expected ${quoteForMessage(expected)}"
            }
        }
        if (checked < 40) fail("the golden file only had $checked normalization cases; it looks truncated")
        assertEquals("normalization diverged from shared/src/utils/server-url.ts:\n" + failures.joinToString("\n"), 0, failures.size)
    }

    @Test
    fun `join matches the recorded TypeScript answers`() {
        val failures = mutableListOf<String>()
        var checked = 0
        var inJoinSection = false
        for (line in goldenText().split("\n")) {
            if (line.startsWith("# columns: join")) {
                inJoinSection = true
                continue
            }
            if (!inJoinSection || line.isBlank() || line.startsWith("#")) continue
            val fields = splitUnescapedTabs(line)
            if (fields.size != 3) continue
            val actual = joinServerUrl(unescape(fields[0]), unescape(fields[1]))
            checked++
            if (actual != unescape(fields[2])) {
                failures += "  join(${quoteForMessage(unescape(fields[0]))}, ${quoteForMessage(unescape(fields[1]))})" +
                    " => ${quoteForMessage(actual)}, expected ${quoteForMessage(unescape(fields[2]))}"
            }
        }
        if (checked < 4) fail("the golden file only had $checked join cases; it looks truncated")
        assertEquals("joinServerUrl diverged:\n" + failures.joinToString("\n"), 0, failures.size)
    }

    /** Split on tabs that are not backslash-escaped. */
    private fun splitUnescapedTabs(line: String): List<String> {
        val fields = mutableListOf<String>()
        val current = StringBuilder()
        var index = 0
        while (index < line.length) {
            val c = line[index]
            when {
                c == '\\' && index + 1 < line.length -> {
                    current.append(c).append(line[index + 1]); index += 2
                }
                c == '\t' -> {
                    fields.add(current.toString()); current.setLength(0); index++
                }
                else -> {
                    current.append(c); index++
                }
            }
        }
        fields.add(current.toString())
        return fields
    }

    private fun quoteForMessage(value: String): String =
        if (value.any { it.isWhitespace() }) "\"" + value.replace("\n", "\\n") + "\"" else "\"$value\""
}

/**
 * `normalizeServerUrl` never throws, which is right for a browser and wrong for a
 * proxy that has to go somewhere. These cover the boundary between the two.
 */
class ServerUrlTargetTest {
    @Test
    fun `an empty address is refused with a reason rather than a bare URL error`() {
        val error = runCatching { toUpstreamUrl("") }.exceptionOrNull()
        assertTrue("expected InvalidTargetError, got $error", error is InvalidTargetError)
        assertTrue(
            "the message has to say what was wrong: ${error?.message}",
            error!!.message!!.contains("no server address"),
        )
    }

    @Test
    fun `an unparseable address is refused before the first request`() {
        val error = runCatching { toUpstreamUrl("not a url") }.exceptionOrNull()
        assertTrue("expected InvalidTargetError, got $error", error is InvalidTargetError)
        assertTrue(error!!.message!!.contains("not a url"))
    }

    @Test
    fun `a scheme the client cannot speak is named in the error`() {
        val error = runCatching { toUpstreamUrl("ftp://example.com") }.exceptionOrNull()
        assertTrue("expected InvalidTargetError, got $error", error is InvalidTargetError)
        assertTrue(
            "the message has to name the scheme: ${error?.message}",
            error!!.message!!.contains("unsupported scheme"),
        )
    }

    @Test
    fun `a bare hostname becomes an https address`() {
        assertEquals("https://code.example.com", toUpstreamUrl("code.example.com").base)
    }

    @Test
    fun `a non-default port survives`() {
        assertEquals(3000, toUpstreamUrl("http://192.168.1.10:3000").port)
    }

    @Test
    fun `a LAN hostname with an underscore is accepted`() {
        // `java.net.URI.getHost()` returns null for this and `URI.getPort()`
        // returns -1 with it, so anything built on those would refuse an address
        // a home server is perfectly reachable at - and lose the port with it.
        val address = toUpstreamUrl("http://my_box.local:3000")
        assertEquals(3000, address.port)
        assertEquals("my_box.local", address.host)
        assertEquals("http://my_box.local:3000", address.base)
    }

    @Test
    fun `a server mounted under a sub-path keeps it`() {
        assertEquals("https://example.com/opencode-manager", toUpstreamUrl("https://example.com/opencode-manager/").base)
    }

    @Test
    fun `the reported target drops a trailing slash`() {
        assertEquals("https://example.com", toUpstreamUrl("https://example.com/").base)
        assertEquals("https://example.com/base", toUpstreamUrl("https://example.com/base/").base)
    }

    @Test
    fun `a request target is applied to the mounted path, not over it`() {
        val mounted = toUpstreamUrl("https://example.com/opencode-manager")
        assertEquals("/opencode-manager/api/health", mounted.withPath("/api/health").path)
        assertEquals("/opencode-manager/", mounted.withPath("/").path)
    }

    @Test
    fun `an address with credentials is refused rather than silently dropping them`() {
        val error = runCatching { toUpstreamUrl("https://user:pw@example.com") }.exceptionOrNull()
        assertTrue("expected InvalidTargetError, got $error", error is InvalidTargetError)
        assertTrue(
            "the message has to say why: ${error?.message}",
            error!!.message!!.contains("username or password"),
        )
    }

    @Test
    fun `an out-of-range port is refused at construction, not at connect time`() {
        // `normalizeServerUrl` cannot tell the difference - it hands back
        // anything it cannot parse, unchanged - so this is the only place the
        // check is visible. Without it the proxy would accept `:99999` as a
        // target and report it as an unreachable server rather than a bad
        // address, which is the difference between a fixable message and a
        // mystery.
        for (bad in listOf("http://example.com:0", "http://example.com:99999", "http://example.com:70000")) {
            val error = runCatching { toUpstreamUrl(bad) }.exceptionOrNull()
            assertTrue("expected $bad to be refused, got $error", error is InvalidTargetError)
        }
    }

    @Test
    fun `origin keeps a non-default port and drops a default one`() {
        assertEquals("http://example.com:3000", targetOrigin(toUpstreamUrl("http://example.com:3000")).origin)
        assertEquals("http://example.com", targetOrigin(toUpstreamUrl("http://example.com:80")).origin)
        assertEquals("https://example.com", targetOrigin(toUpstreamUrl("https://example.com:443")).origin)
    }
}