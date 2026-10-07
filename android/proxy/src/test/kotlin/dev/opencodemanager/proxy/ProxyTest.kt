package dev.opencodemanager.proxy

import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * End-to-end over real loopback sockets.
 *
 * The unit tests beside these can all be satisfied by a proxy that never calls
 * them. These cannot: they start a real upstream, drive a real client, and check
 * what each side actually received on the wire.
 */
class ProxyTest {
    private val seenRequests = java.util.Collections.synchronizedList(mutableListOf<RecordedRequest>())

    @Test
    fun `a request reaches the upstream with the method, path and query intact`() {
        val seen = AtomicReference<RecordedRequest>()
        FakeUpstream { socket, request ->
            seen.set(request)
            socket.respond(body = "pong")
        }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                openToProxy(proxy.port, simpleGet("/api/projects?limit=5&cursor=a%2Fb")).use { client ->
                    val response = client.readResponse()
                    assertEquals(200, response.status)
                    assertEquals("pong", response.bodyText)
                }
            }
        }
        assertNotNull(seen.get())
        assertEquals("GET", seen.get().method)
        assertEquals("/api/projects?limit=5&cursor=a%2Fb", seen.get().target)
    }

    @Test
    fun `PATCH survives`() {
        // `HttpURLConnection` downgrades PATCH to POST. The reason this proxy
        // speaks HTTP over a raw socket rather than using one.
        val seen = AtomicReference<RecordedRequest>()
        FakeUpstream { socket, request ->
            seen.set(request)
            socket.respond()
        }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                openToProxy(
                    proxy.port,
                    "PATCH /api/settings HTTP/1.1\r\nhost: 127.0.0.1\r\ncontent-length: 2\r\n\r\n{}",
                ).use { it.readResponse() }
            }
        }
        assertEquals("PATCH", seen.get().method)
    }

    @Test
    fun `the upstream sees the upstream's own origin, not loopback`() {
        // The single most important line in this file. better-auth refuses a
        // request whose Origin is not trusted, and does so with a 403 rather
        // than a CORS error the UI could explain.
        val seen = AtomicReference<RecordedRequest>()
        var upstreamUrl = ""
        FakeUpstream { socket, request ->
            seen.set(request)
            socket.respond(body = "ok")
        }.use { upstream ->
            upstreamUrl = upstream.url
            runningProxy(upstream.url).use { proxy ->
                val request = buildString {
                    append("POST /api/auth/sign-in/email HTTP/1.1\r\n")
                    append("host: 127.0.0.1\r\n")
                    append("origin: http://127.0.0.1:").append(proxy.port).append("\r\n")
                    append("referer: http://127.0.0.1:").append(proxy.port).append("/login?tab=1\r\n")
                    append("content-type: application/json\r\n")
                    append("content-length: 2\r\n\r\n")
                }
                openToProxy(proxy.port, request, "{}").use { it.readResponse() }
            }
        }
        assertEquals(upstreamUrl, seen.get().header("origin"))
        assertEquals(
            "the Host header has to name the upstream's port, or handlers build wrong absolute URLs",
            upstreamUrl.removePrefix("http://"),
            seen.get().header("host"),
        )
        assertEquals(
            "the referer keeps its path so handlers that read it see the same URL",
            "$upstreamUrl/login?tab=1",
            seen.get().header("referer"),
        )
    }

    @Test
    fun `a session cookie comes back usable on this origin`() {
        // Without the Domain removal the browser silently discards it, and the
        // app reports "your session did not travel" as "your password is wrong".
        FakeUpstream { socket, _ ->
            socket.respond(
                status = "HTTP/1.1 200 OK",
                headers = listOf(
                    "content-type" to "application/json",
                    "set-cookie" to "better-auth.session_token=abc; Domain=127.0.0.1; Path=/; HttpOnly",
                    "set-cookie" to "ocm_pref=x; Domain=127.0.0.1; Secure; Path=/",
                ),
                body = "{}",
            )
        }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                openToProxy(proxy.port, simpleGet("/api/auth/get-session")).use { client ->
                    val response = client.readResponse()
                    val cookies = response.headerValues("set-cookie")
                    assertEquals(2, cookies.size)
                    assertEquals("better-auth.session_token=abc; Path=/; HttpOnly", cookies[0])
                    assertEquals(
                        "Secure is dropped on loopback http, or the cookie never works",
                        "ocm_pref=x; Path=/",
                        cookies[1],
                    )
                }
            }
        }
    }

    @Test
    fun `a cookie keeps Secure when the app is served over https`() {
        FakeUpstream { socket, _ ->
            socket.respond(
                headers = listOf("set-cookie" to "a=1; Secure; Path=/"),
                body = "{}",
            )
        }.use { upstream ->
            runningProxy(upstream.url, secureTransport = true).use { proxy ->
                openToProxy(proxy.port, simpleGet("/api/x")).use { client ->
                    val response = client.readResponse()
                    assertEquals("a=1; Secure; Path=/", response.header("set-cookie"))
                }
            }
        }
    }

    @Test
    fun `a CSP that pins connect-src to the upstream is narrowed`() {
        FakeUpstream { socket, _ ->
            socket.respond(
                headers = listOf(
                    "content-security-policy" to
                        "default-src 'self'; connect-src https://code.example.com; img-src 'self' data:",
                ),
                body = "<html></html>",
            )
        }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                openToProxy(proxy.port, simpleGet("/")).use { client ->
                    val response = client.readResponse()
                    val csp = response.header("content-security-policy")
                    assertNotNull(csp)
                    assertTrue(
                        "connect-src pinned to anything but 'self' blocks the proxy's own calls: $csp",
                        csp!!.contains("connect-src 'self'"),
                    )
                    assertTrue("other directives must survive: $csp", csp!!.contains("default-src 'self'"))
                    assertTrue("other directives must survive: $csp", csp!!.contains("img-src 'self' data:"))
                }
            }
        }
    }

    @Test
    fun `an absolute redirect is rewritten to stay on this origin`() {
        var upstreamUrl = ""
        FakeUpstream { socket, _ ->
            socket.respond(status = "HTTP/1.1 302 Found", headers = listOf("location" to "$upstreamUrl/login?next=/x"), body = "")
        }.use { upstream ->
            upstreamUrl = upstream.url
            runningProxy(upstream.url).use { proxy ->
                openToProxy(proxy.port, simpleGet("/api/auth/")).use { client ->
                    val response = client.readResponse()
                    assertEquals(302, response.status)
                    assertEquals("/login?next=/x", response.header("location"))
                }
            }
        }
    }

    @Test
    fun `a request body arrives at the upstream`() {
        val seen = AtomicReference<RecordedRequest>()
        val payload = """{"name":"my project"}"""
        FakeUpstream { socket, request ->
            seen.set(request)
            socket.respond(body = "{}")
        }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                openToProxy(
                    proxy.port,
                    "POST /api/projects HTTP/1.1\r\nhost: 127.0.0.1\r\ncontent-type: application/json\r\n" +
                        "content-length: ${payload.length}\r\n\r\n",
                    payload,
                ).use { it.readResponse() }
            }
        }
        assertEquals(payload, seen.get().bodyText)
        assertEquals(payload.length.toString(), seen.get().header("content-length"))
    }

    @Test
    fun `a chunked upstream response is decoded`() {
        FakeUpstream { socket, _ ->
            socket.respondHead(
                headers = listOf("content-type" to "text/plain", "transfer-encoding" to "chunked"),
            )
            socket.writeChunk("first ")
            socket.writeChunk("second")
            socket.getOutputStream().write("0\r\n\r\n".toByteArray(Charsets.ISO_8859_1))
            socket.getOutputStream().flush()
        }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                openToProxy(proxy.port, simpleGet("/api/big")).use { client ->
                    val response = client.readResponse()
                    assertEquals("first second", response.bodyText)
                }
            }
        }
    }

    @Test
    fun `HEAD gets no body`() {
        FakeUpstream { socket, _ ->
            socket.respond(headers = listOf("content-length" to "1234", "x-thing" to "v"), body = "")
        }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                val request = "HEAD /api/projects HTTP/1.1\r\nhost: 127.0.0.1\r\n\r\n"
                openToProxy(proxy.port, request).use { client ->
                    val response = client.readResponse()
                    assertEquals(200, response.status)
                    assertEquals("v", response.header("x-thing"))
                    assertEquals("a HEAD response must not carry a body", 0, response.body.size)
                }
            }
        }
    }

    @Test
    fun `204 gets no body`() {
        FakeUpstream { socket, _ ->
            socket.respond(status = "HTTP/1.1 204 No Content", headers = emptyList(), body = "")
        }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                openToProxy(proxy.port, "DELETE /api/x HTTP/1.1\r\nhost: 127.0.0.1\r\n\r\n").use { client ->
                    val response = client.readResponse()
                    assertEquals(204, response.status)
                    assertEquals(0, response.body.size)
                }
            }
        }
    }

    @Test
    fun `an unreachable upstream is a 502 that names the server`() {
        // 500 places a stack trace in front of the user for what is a typo in
        // their settings.
        val proxy = runningProxy("http://127.0.0.1:1")
        proxy.use {
            openToProxy(proxy.port, simpleGet("/api/health")).use { client ->
                    val response = client.readResponse()
                assertEquals(502, response.status)
                assertTrue(
                    "the message has to name the server: ${response.bodyText}",
                    response.bodyText.contains("127.0.0.1:1"),
                )
            }
        }
    }

    @Test
    fun `the control endpoint reports the current target`() {
        FakeUpstream { socket, _ -> socket.respond(body = "{}") }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                openToProxy(proxy.port, simpleGet("/__ocm/target")).use { client ->
                    val response = client.readResponse()
                    assertEquals(200, response.status)
                    assertEquals(
                        upstream.url,
                        extractTarget(response.bodyText),
                    )
                }
            }
        }
    }

    @Test
    fun `changing the target takes effect on the next request`() {
        val first = AtomicReference<RecordedRequest>()
        val second = AtomicReference<RecordedRequest>()
        FakeUpstream { socket, request ->
            first.set(request)
            socket.respond(body = "first-server")
        }.use { a ->
            FakeUpstream { socket, request ->
                second.set(request)
                socket.respond(body = "second-server")
            }.use { b ->
                runningProxy(a.url).use { proxy ->
                    openToProxy(proxy.port, simpleGet("/api/x")).use { assertEquals("first-server", it.readResponse().bodyText) }

                    openToProxy(
                        proxy.port,
                        "PUT /__ocm/target HTTP/1.1\r\nhost: 127.0.0.1\r\ncontent-length: ${b.url.length + 12}\r\n\r\n",
                        """{"target":"${b.url}"}""",
                    ).use { client ->
                    val response = client.readResponse()
                        assertEquals(200, response.status)
                        assertEquals(b.url, extractTarget(response.bodyText))
                    }

                    openToProxy(proxy.port, simpleGet("/api/x")).use { assertEquals("second-server", it.readResponse().bodyText) }
                }
            }
        }
        assertNotNull("the first upstream should have been asked", first.get())
        assertNotNull("the second upstream should have been asked", second.get())
    }

    @Test
    fun `a bad address is refused and the working one is kept`() {
        FakeUpstream { socket, _ -> socket.respond(body = "still-here") }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                val bad = """{"target":"not a url"}"""
                openToProxy(
                    proxy.port,
                    "PUT /__ocm/target HTTP/1.1\r\nhost: 127.0.0.1\r\ncontent-length: ${bad.length}\r\n\r\n",
                    bad,
                ).use { client ->
                    val response = client.readResponse()
                    assertEquals(400, response.status)
                    assertTrue(response.bodyText.contains("invalid_target"))
                }
                openToProxy(proxy.port, simpleGet("/api/x")).use {
                    assertEquals("a refused change must not break the client", "still-here", it.readResponse().bodyText)
                }
            }
        }
    }

    @Test
    fun `an unknown control endpoint is a 404, not a silent pass-through`() {
        FakeUpstream { socket, _ -> socket.respond(body = "upstream-saw-it") }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                openToProxy(proxy.port, simpleGet("/__ocm/nope")).use { client ->
                    val response = client.readResponse()
                    assertEquals(404, response.status)
                    assertTrue(
                        "the proxy's own namespace must not leak to the upstream: ${response.bodyText}",
                        !response.bodyText.contains("upstream-saw-it"),
                    )
                }
            }
        }
    }

    @Test
    fun `a server mounted under a sub-path keeps it`() {
        val seen = AtomicReference<RecordedRequest>()
        FakeUpstream { socket, request ->
            seen.set(request)
            socket.respond(body = "ok")
        }.use { upstream ->
            runningProxy("${upstream.url}/opencode-manager").use { proxy ->
                openToProxy(proxy.port, simpleGet("/api/health")).use { it.readResponse() }
            }
        }
        assertEquals("/opencode-manager/api/health", seen.get().target)
    }

    @Test
    fun `the app itself is fetched through the proxy, not from the APK`() {
        // A bundled frontend would be stale the moment the server is updated.
        FakeUpstream { socket, request ->
            seenRequests.add(request)
            socket.respond(
                headers = listOf("content-type" to "text/html"),
                body = "<!doctype html><title>OpenCode Manager</title>",
            )
        }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                openToProxy(proxy.port, simpleGet("/")).use { client ->
                    val response = client.readResponse()
                    assertEquals(200, response.status)
                    assertTrue(response.bodyText.contains("OpenCode Manager"))
                }
            }
        }
        assertEquals("/", seenRequests.last().target)
    }

    // ---------------------------------------------------------------------
    // Streaming. The part a buffering proxy passes every other test above.
    // ---------------------------------------------------------------------

    @Test
    fun `a stream frame reaches the client before the stream ends`() {
        // The upstream sends one frame and then waits for this test to let it
        // send the next. A proxy that buffers the body has to wait for the
        // response to end before writing anything, so the read below times out
        // and the test fails. There is no third outcome: a frame either arrives
        // while the stream is still open or it does not.
        val release = CountDownLatch(1)
        FakeUpstream { socket, _ ->
            socket.respondHead(
                headers = listOf("content-type" to "text/event-stream", "transfer-encoding" to "chunked"),
            )
            socket.writeChunk("data: first\n\n")
            release.await(10, TimeUnit.SECONDS)
            socket.writeChunk("data: second\n\n")
            socket.getOutputStream().write("0\r\n\r\n".toByteArray(Charsets.ISO_8859_1))
            socket.getOutputStream().flush()
        }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                val client = openToProxy(proxy.port, simpleGet("/api/sse/stream"), readTimeoutMs = 4000)
                client.use {
                    val input = it.getInputStream()
                    assertEquals("HTTP/1.1 200 OK", readLine(input))
                    while (true) {
                        val line = readLine(input)
                        if (line.isNullOrEmpty()) break
                    }

                    val seen = StringBuilder()
                    val deadline = System.currentTimeMillis() + 4000
                    while (!seen.contains("first") && System.currentTimeMillis() < deadline) {
                        val chunk = readOneChunk(input)
                        if (chunk == null) break
                        seen.append(chunk)
                    }

                    assertTrue(
                        "the first frame never arrived while the stream was still open; " +
                            "the body is being buffered somewhere. Got: \"$seen\"",
                        seen.contains("first"),
                    )
                    assertTrue("the second frame must still be pending", !seen.contains("second"))

                    release.countDown()
                    val rest = StringBuilder()
                    val second = CountDownLatch(1)
                    val reader = Thread {
                        try {
                            while (!rest.contains("second")) {
                                val chunk = readOneChunk(input) ?: break
                                rest.append(chunk)
                            }
                        } finally {
                            second.countDown()
                        }
                    }
                    reader.isDaemon = true
                    reader.start()
                    await(second, 10)
                    assertTrue("the second frame never arrived: \"$rest\"", rest.contains("second"))
                }
            }
        }
    }

    /**
     * Read one chunk off a chunked stream without waiting for the next one. */
    private fun readOneChunk(input: java.io.InputStream): String? {
        val sizeLine = readLine(input) ?: return null
        if (sizeLine.isEmpty()) return null
        val size = sizeLine.substringBefore(';').trim().toIntOrNull(16) ?: return null
        if (size == 0) return null
        val buffer = ByteArray(size)
        var read = 0
        while (read < size) {
            val got = input.read(buffer, read, size - read)
            if (got < 0) return null
            read += got
        }
        readLine(input)
        return String(buffer, Charsets.UTF_8)
    }

    @Test
    fun `the terminal stream reaches the client frame by frame`() {
        // Same guarantee, for the endpoint where getting it wrong turns a live
        // terminal into a frozen one with nothing in the UI to explain it.
        val release = CountDownLatch(1)
        FakeUpstream { socket, _ ->
            socket.respondHead(headers = listOf("content-type" to "text/event-stream", "transfer-encoding" to "chunked"))
            socket.writeChunk("{\"type\":\"output\",\"data\":\"$ ls\\n\"}\n")
            release.await(10, TimeUnit.SECONDS)
            socket.writeChunk("{\"type\":\"output\",\"data\":\"file.txt\\n\"}\n")
            socket.getOutputStream().write("0\r\n\r\n".toByteArray(Charsets.ISO_8859_1))
            socket.getOutputStream().flush()
        }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                val client = openToProxy(proxy.port, simpleGet("/api/terminal/sessions/abc/stream"), readTimeoutMs = 4000)
                client.use { socket ->
                    val input: java.io.InputStream = socket.getInputStream()
                    assertEquals("HTTP/1.1 200 OK", readLine(input))
                    while (true) {
                        if (readLine(input).isNullOrEmpty()) break
                    }
                    val first = readOneChunk(input)
                    assertNotNull("no chunk arrived while the stream was open", first)
                    assertTrue("the first terminal frame never arrived: \"$first\"", first!!.contains("ls"))
                    release.countDown()
                }
            }
        }
    }

    @Test
    fun `an upstream that has answered is never given a read timeout`() {
        // A stream is silent for minutes at a time. A read timeout left on it
        // would cut a live terminal mid-thought, and the only way to notice in a
        // test would be to sit and wait for the timeout to expire - so the
        // invariant is asserted directly instead.
        val seen = AtomicReference<Int>()
        FakeUpstream { socket, _ ->
            socket.respondHead(headers = listOf("content-type" to "text/event-stream", "transfer-encoding" to "chunked"))
            socket.writeChunk("data: one\n\n")
            Thread.sleep(150)
            socket.writeChunk("data: two\n\n")
            socket.getOutputStream().write("0\r\n\r\n".toByteArray(Charsets.ISO_8859_1))
            socket.getOutputStream().flush()
        }.use { upstream ->
            val address = toUpstreamUrl(upstream.url)
            val origin = targetOrigin(address)
            sendUpstream("GET", address, "/api/sse/stream", buildUpstreamHeaders(emptyMap(), origin), BodySource.EMPTY)
                .use { response ->
                    seen.set(response.readTimeoutMs)
                    response.copyBodyTo(java.io.OutputStream.nullOutputStream())
                }
        }
        assertEquals(
            "a read timeout on the response body is how a live stream gets cut",
            0,
            seen.get(),
        )
    }

    @Test
    fun `a client that goes away mid-stream does not hang the proxy`() {
        // An abandoned terminal session would otherwise stay open on the server
        // until its own heartbeat gave up on it.
        val upstreamSawTheClose = CountDownLatch(1)
        FakeUpstream { socket, request ->
            if (request.target.startsWith("/api/health")) {
                socket.respond(body = """{"status":"healthy"}""")
                return@FakeUpstream
            }
            socket.respondHead(headers = listOf("content-type" to "text/event-stream", "transfer-encoding" to "chunked"))
            socket.writeChunk("data: one\n\n")
            try {
                while (socket.getInputStream().read() >= 0) {
                    // wait for the client to hang up
                }
            } catch (_: Exception) {
                // expected
            }
            upstreamSawTheClose.countDown()
        }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                val client = openToProxy(proxy.port, simpleGet("/api/sse/stream"), readTimeoutMs = 4000)
                val input = client.getInputStream()
                readLine(input)
                while (true) {
                    if (readLine(input).isNullOrEmpty()) break
                }
                readOneChunk(input)
                client.close()

                assertTrue(
                    "the upstream connection was not torn down after the client left",
                    upstreamSawTheClose.await(10, TimeUnit.SECONDS),
                )

                // And the proxy still serves the next request.
                openToProxy(proxy.port, simpleGet("/api/health")).use { client ->
                    val response = client.readResponse()
                    assertEquals(200, response.status)
                    assertEquals("""{"status":"healthy"}""", response.bodyText)
                }
            }
        }
    }
}

/**
 * Connection reuse.
 *
 * Every other test in this file opens its own socket, which is exactly why a
 * proxy that answered one request per connection passed all of them and then
 * showed a real phone an app that believed it was offline: a browser sends its
 * next request down the connection it already has, and finds it dead. curl
 * hides that by retrying idempotent GETs. These are the tests that cannot be
 * written that way.
 */
class ProxyKeepAliveTest {
    @Test
    fun `several requests travel down one connection`() {
        val seen = java.util.Collections.synchronizedList(mutableListOf<RecordedRequest>())
        val counter = java.util.concurrent.atomic.AtomicInteger(0)
        FakeUpstream { socket, request ->
            seen.add(request)
            socket.respond(body = """{"n":${counter.incrementAndGet()}}""")
        }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                Socket().use { client ->
                    client.connect(InetSocketAddress("127.0.0.1", proxy.port), 5000)
                    client.soTimeout = 5000
                    val bodies = mutableListOf<String>()
                    repeat(3) {
                        client.getOutputStream().write(simpleGet("/api/x?i=$it").toByteArray(Charsets.ISO_8859_1))
                        client.getOutputStream().flush()
                        bodies.add(client.readResponse().bodyText)
                    }
                    assertEquals(
                        listOf("""{"n":1}""", """{"n":2}""", """{"n":3}"""),
                        bodies,
                    )
                }
            }
        }
        assertEquals("the upstream should have seen all three, saw ${seen.size}", 3, seen.size)
    }

    @Test
    fun `a POST down a reused connection is not lost`() {
        // A browser does not retry a POST when the connection turns out to be
        // dead, so this is the request that turns a missing keep-alive into a
        // silent failure instead of a visible one.
        val seen = java.util.Collections.synchronizedList(mutableListOf<RecordedRequest>())
        val first = """{"name":"one"}"""
        val second = """{"name":"two"}"""
        FakeUpstream { socket, request ->
            seen.add(request)
            socket.respond(body = "{}")
        }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                Socket().use { client ->
                    client.connect(InetSocketAddress("127.0.0.1", proxy.port), 5000)
                    client.soTimeout = 5000
                    val payloads = listOf(first, second)
                    payloads.forEachIndexed { index, payload ->
                        client.getOutputStream().write(
                            ("POST /api/projects HTTP/1.1\r\nhost: 127.0.0.1\r\n" +
                                "content-type: application/json\r\ncontent-length: ${payload.length}\r\n\r\n$payload")
                                .toByteArray(Charsets.ISO_8859_1),
                        )
                        client.getOutputStream().flush()
                        val response = client.readResponse()
                        assertEquals("request ${index + 1} of ${payloads.size} on the shared connection", 200, response.status)
                    }
                }
            }
        }
        assertEquals("both POSTs should have reached the upstream, saw ${seen.size}", 2, seen.size)
        assertEquals(second, seen[1].bodyText)
    }

    @Test
    fun `a response that keeps the connection says nothing about closing it`() {
        FakeUpstream { socket, _ -> socket.respond(body = "ok") }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                openToProxy(proxy.port, simpleGet("/api/x")).use { client ->
                    assertEquals(
                        "saying `connection: close` while the connection is being kept makes the browser" +
                            "open a new one for everything; saying nothing while it is about to be closed makes" +
                            "the browser reuse a socket that is about to die",
                        null,
                        client.readResponse().header("connection"),
                    )
                }
            }
        }
    }

    @Test
    fun `a client that asks to close is told so`() {
        FakeUpstream { socket, _ -> socket.respond(body = "ok") }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                openToProxy(proxy.port, "GET /api/x HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: close\r\n\r\n").use { client ->
                    assertEquals("close", client.readResponse().header("connection"))
                }
            }
        }
    }

    @Test
    fun `a client that asks to close finds the connection shut, not just told so`() {
        // The test above reads the header and stops, which settles the promise
        // but not the fact behind it. A proxy that sends `connection: close`
        // and then goes on waiting to read another request off the same socket
        // has told the client something it has not done, and holds a thread for
        // as long as the client takes to hang up.
        //
        // So the socket is read to its end rather than asked a question: shut,
        // the read comes back immediately; open and idle, it blocks until the
        // timeout. Checking for end-of-stream rather than for a second response
        // is what keeps this from being a race.
        FakeUpstream { socket, _ -> socket.respond(body = "ok") }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                openToProxy(proxy.port, "GET /api/x HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: close\r\n\r\n").use { client ->
                    assertEquals("close", client.readResponse().header("connection"))
                    client.soTimeout = 3000
                    val shut = try {
                        client.getInputStream().read() == -1
                    } catch (_: java.net.SocketTimeoutException) {
                        false
                    }
                    assertTrue(
                        "the proxy said `connection: close` and then kept waiting on that same socket",
                        shut,
                    )
                }
            }
        }
    }

    @Test
    // HTTP/1.0 closes by default; only the version's spelling changes, so the name
    // says "legacy" rather than putting a dot in a backtick identifier.
    fun `a legacy client without keep-alive gets a close`() {
        FakeUpstream { socket, _ -> socket.respond(body = "ok") }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                openToProxy(proxy.port, "GET /api/x HTTP/1.0\r\nhost: 127.0.0.1\r\n\r\n").use { client ->
                    assertEquals("close", client.readResponse().header("connection"))
                }
            }
        }
    }

    @Test
    fun `a legacy client that asks for keep-alive is served on that connection`() {
        val seen = java.util.Collections.synchronizedList(mutableListOf<RecordedRequest>())
        FakeUpstream { socket, request ->
            seen.add(request)
            socket.respond(body = "ok")
        }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                Socket().use { client ->
                    client.connect(InetSocketAddress("127.0.0.1", proxy.port), 5000)
                    client.soTimeout = 5000
                    repeat(2) { index ->
                        client.getOutputStream().write(
                            "GET /api/x HTTP/1.0\r\nhost: 127.0.0.1\r\nconnection: keep-alive\r\n\r\n"
                                .toByteArray(Charsets.ISO_8859_1),
                        )
                        client.getOutputStream().flush()
                        val response = client.readResponse()
                        assertEquals("request ${index + 1} of 2 on the shared connection", 200, response.status)
                    }
                }
            }
        }
        assertEquals("both HTTP/1.0 requests should have been served, saw ${seen.size}", 2, seen.size)
    }

    @Test
    fun `a stream ends its connection, and says so`() {
        FakeUpstream { socket, _ ->
            socket.respondHead(headers = listOf("content-type" to "text/event-stream", "transfer-encoding" to "chunked"))
            socket.writeChunk("data: one\n\n")
            socket.getOutputStream().write("0\r\n\r\n".toByteArray(Charsets.ISO_8859_1))
            socket.getOutputStream().flush()
        }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                openToProxy(proxy.port, simpleGet("/api/sse/stream")).use { client ->
                    assertEquals("close", client.readResponse().header("connection"))
                }
            }
        }
    }

    @Test
    fun `a finished stream leaves its connection shut rather than waiting for more`() {
        // The header above is half the promise; this is the other half. A proxy
        // that says `connection: close` and then sits waiting for the next
        // request is holding the socket open while a second thread reads the
        // same input stream to notice the client hanging up - so the next
        // request is a race between two readers, and it is not a request the
        // proxy ever agreed to serve.
        //
        // Checking that the socket is *closed* rather than asking for a second
        // response is what makes this deterministic: with the connection shut,
        // the read returns end-of-stream immediately; with it open and idle, it
        // blocks until the timeout. Asking for another response would leave the
        // verdict up to which of two threads won.
        FakeUpstream { socket, _ ->
            socket.respondHead(headers = listOf("content-type" to "text/event-stream", "transfer-encoding" to "chunked"))
            socket.writeChunk("data: one\n\n")
            socket.getOutputStream().write("0\r\n\r\n".toByteArray(Charsets.ISO_8859_1))
            socket.getOutputStream().flush()
        }.use { upstream ->
            runningProxy(upstream.url).use { proxy ->
                openToProxy(proxy.port, simpleGet("/api/sse/stream")).use { client ->
                    assertEquals("close", client.readResponse().header("connection"))
                    client.soTimeout = 3000
                    val closed = try {
                        client.getInputStream().read() == -1
                    } catch (_: java.net.SocketTimeoutException) {
                        false
                    }
                    assertTrue(
                        "the proxy is still holding this connection open after a stream ended, " +
                            "waiting for a request it has already refused by sending `connection: close`",
                        closed,
                    )
                }
            }
        }
    }

    @Test
    fun `a control response says it is closing the connection, because it is`() {
        // The two responses the proxy writes itself - the control plane and the
        // 502 - both end the connection, because neither has a framing that
        // could survive into the next request on it. Neither used to say so.
        // The comment in `serve` claimed they did. A client that reads the
        // header is entitled to reuse that connection, and then finds it dead,
        // which is the whole failure this file exists to prevent - arriving via
        // a path that never went through `forward`, and therefore through none
        // of the fixes there.
        runningProxy("http://127.0.0.1:1").use { proxy ->
            openToProxy(proxy.port, simpleGet("/__ocm/target")).use { client ->
                assertEquals(
                    "a control response ends the connection and must say so",
                    "close",
                    client.readResponse().header("connection"),
                )
            }
        }
    }

    @Test
    fun `an upstream that cannot be reached says it is closing the connection, because it is`() {
        // Port 1 refuses, so this is the 502 path rather than the control path.
        runningProxy("http://127.0.0.1:1").use { proxy ->
            openToProxy(proxy.port, simpleGet("/api/projects")).use { client ->
                val response = client.readResponse()
                assertEquals(502, response.status)
                assertEquals(
                    "the 502 ends the connection and must say so, or the next request on it dies",
                    "close",
                    response.header("connection"),
                )
            }
        }
    }
}
