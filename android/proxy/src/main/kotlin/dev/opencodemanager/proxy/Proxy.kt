package dev.opencodemanager.proxy

import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

/** Paths the proxy answers itself. Everything else goes upstream. */
private const val CONTROL_PREFIX = "/__ocm/"

/** A control body is a short JSON document; anything larger is a mistake. */
private const val MAX_CONTROL_BODY = 64 * 1024

/** An `InputStream` that stops after `limit` bytes, for a `content-length` body.
 *
 *  `close()` deliberately does nothing. The source is the client socket, and
 *  [BodySource.writeTo] closes the stream it is given; a wrapper that forwarded
 *  that would shut the client's input down the moment a request body was read,
 *  so every request *with a body* would leave the connection dead for reuse
 *  afterwards. Requests without a body never went through here, which is why
 *  this cost a real device to find: the GETs kept working and the POSTs did not. */
internal class BoundedInputStream(
    private val source: InputStream,
    private var limit: Long,
) : InputStream() {
    override fun read(): Int {
        if (limit <= 0) return -1
        val value = source.read()
        if (value >= 0) limit--
        return value
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (limit <= 0) return -1
        val read = source.read(buffer, offset, minOf(length.toLong(), limit).toInt())
        if (read > 0) limit -= read
        return read
    }

    override fun available(): Int = minOf(source.available().toLong(), limit).toInt()

    /** This wrapper owns the limit, not the socket underneath it. */
    override fun close() = Unit
}

private class RequestHead(
    val method: String,
    /** Request target, query string included, with any absolute-form prefix removed. */
    val target: String,
    val version: String,
    val headers: Map<String, List<String>>,
) {
    /** Whether the client asked for this connection to be closed after one
     *  request. HTTP/1.1 keeps it open unless told otherwise; HTTP/1.0 is the
     *  other way round. */
    val wantsClose: Boolean
        get() {
            val connection = headers["connection"]?.joinToString(",")?.lowercase() ?: return version == "HTTP/1.0"
            if (connection.contains("close")) return true
            return version == "HTTP/1.0" && !connection.contains("keep-alive")
        }
}

/**
 * A same-origin reverse proxy between the Android client and an OpenCode Manager
 * server.
 *
 * The WebView is pointed at `http://127.0.0.1:<port>/`, and this serves that
 * origin - which is the entire trick. better-auth's session cookie is
 * `SameSite=Lax`, so a WebView pointed straight at a remote origin drops the
 * cookie on every authenticated XHR: the request passes the CORS layer and comes
 * back 401, with nothing in the UI saying why. Being same-origin lines up both
 * the browser's cookie rules and the server's origin checks at once.
 *
 * Unlike the desktop proxy, this forwards **everything** - the app's own HTML,
 * JS and CSS included - and serves nothing out of the APK. A bundled frontend
 * would mean a multi-megabyte APK holding a copy of the app that is stale the
 * moment the server is updated; fetching it over the same hop costs one loopback
 * hop and is always current.
 *
 * Streaming is the part that must not be got wrong. The terminal
 * (`/api/terminal/sessions/:id/stream`) and the event stream (`/api/sse/stream`)
 * are `text/event-stream` that never end; a proxy that collects the body before
 * responding turns a live terminal into a frozen one with no error to explain
 * it. So the response body is decoded and re-framed chunk by chunk with a flush
 * per chunk, and no socket gets a read timeout once its head is in.
 */
class ProxyServer(
    initialTarget: String,
    private val secureTransport: Boolean = false,
    private val onError: ((Throwable, String) -> Unit)? = null,
) : java.io.Closeable {
    /** Validated when the object is built, so a bad address is reported while
     *  there is still somewhere to report it to. */
    private val upstream = AtomicReference(toUpstreamUrl(initialTarget))

    private var serverSocket: ServerSocket? = null
    private var workers: ExecutorService? = null
    @Volatile private var running = false

    /** The port the WebView should be pointed at. 0 until [start] returns. */
    @Volatile var port: Int = 0
        private set

    fun target(): String = upstream.get().base

    /** Point the proxy somewhere else. Throws [InvalidTargetError] rather than
     *  leaving a typo to surface later as a refused connection. */
    fun setTarget(next: String): String {
        val parsed = toUpstreamUrl(next)
        upstream.set(parsed)
        return parsed.base
    }

    /** Bind to loopback and start serving. Returns the bound port.
     *
     *  `preferredPort` matters more than it looks. The WebView's origin is
     *  `http://127.0.0.1:<port>`, and an ephemeral port means a *different*
     *  origin on every launch: localStorage is discarded and the session cookie
     *  is discarded, so the person is silently signed out each time they open the
     *  app. A stable origin is what makes "remember me" mean anything. The
     *  caller is expected to remember the port it got back and pass it again. */
    fun start(preferredPort: Int = 0): Int {
        check(!running) { "proxy already started" }
        val socket = try {
            ServerSocket(preferredPort, 64, InetAddress.getByName("127.0.0.1"))
        } catch (error: IOException) {
            // The remembered port is taken by something else. An ephemeral one
            // still serves correctly; it only costs a re-login, so it is a
            // graceful degradation rather than a failure.
            if (preferredPort <= 0) throw error
            ServerSocket(0, 64, InetAddress.getByName("127.0.0.1"))
        }
        val pool = Executors.newCachedThreadPool { runnable ->
            Thread(runnable, "ocm-proxy").apply { isDaemon = true }
        }
        serverSocket = socket
        workers = pool
        running = true
        port = socket.localPort
        Thread({ accept(socket, pool) }, "ocm-proxy-accept").apply {
            isDaemon = true
            start()
        }
        return port
    }

    fun stop() {
        running = false
        try {
            serverSocket?.close()
        } catch (_: Exception) {
            // Already closed.
        }
        workers?.shutdownNow()
        serverSocket = null
        workers = null
        port = 0
    }

    override fun close() = stop()

    private fun accept(socket: ServerSocket, pool: ExecutorService) {
        while (running) {
            val client = try {
                socket.accept()
            } catch (_: Exception) {
                if (running) onError?.invoke(IllegalStateException("accept failed while running"), "/")
                return
            }
            try {
                pool.execute { handleConnection(client) }
            } catch (_: Exception) {
                // The pool is shutting down; nothing left to serve this one.
                try {
                    client.close()
                } catch (_: Exception) {
                    // ignore
                }
            }
        }
    }

    /**
     * One connection, many requests.
     *
     * HTTP/1.1 keeps a connection open unless either side says otherwise, and a
     * browser will send its next request down it the moment the first response
     * ends. Answering one request and then closing - which is what this did
     * before a real device caught it - looks fine to every test here, because
     * each of them opens its own socket, and fails in a browser as a *connection
     * error*: curl retries an idempotent GET and hides it, but a POST is not
     * retried, and neither is a request that was already in flight. The symptom
     * on screen is the whole app reporting itself offline.
     */
    private fun handleConnection(client: Socket) {
        client.use { connection ->
            connection.tcpNoDelay = true
            val input = connection.getInputStream()
            val output = BufferedOutputStream(connection.getOutputStream(), 32 * 1024)
            try {
                while (serve(input, output)) {
                    // Another request is coming down the same connection.
                }
            } catch (error: Throwable) {
                // A browser that navigates away mid-request closes the socket
                // underneath us. That is ordinary traffic, not a fault, and it
                // must not be reported as "the app is broken". An IOException is
                // that; anything else is ours.
                if (error !is ProxyConnectionLost && error !is IOException) onError?.invoke(error, "/")
            }
        }
    }

    /** Serve one request. Returns true when this connection may be reused. */
    private fun serve(input: InputStream, output: OutputStream): Boolean {
        val head = readRequestHead(input) ?: return false
        val path = head.target.substringBefore('?')

        if (path.startsWith(CONTROL_PREFIX)) {
            handleControl(head.method, path, readBody(input, head), output)
            // A control response has said so itself; see `json`.
            return false
        }
        // A response that may never end owns its connection until it does, and
        // the thread watching for the client leaving would consume the next
        // request if we tried to keep it alive.
        if (forward(head, head.target, input, output)) return false
        return !head.wantsClose
    }

    private fun readRequestHead(input: InputStream): RequestHead? {
        val requestLine = readLine(input) ?: return null
        val parts = requestLine.split(' ')
        if (parts.size < 2) throw ProxyConnectionLost("not an HTTP request: \"$requestLine\"")
        val headers = LinkedHashMap<String, MutableList<String>>()
        var count = 0
        while (true) {
            val line = readLine(input) ?: break
            if (line.isEmpty()) break
            if (++count > MAX_HEADERS) throw ProxyConnectionLost("more than $MAX_HEADERS request headers")
            val colon = line.indexOf(':')
            if (colon <= 0) continue
            headers.getOrPut(line.substring(0, colon).trim().lowercase()) { ArrayList(1) }
                .add(line.substring(colon + 1).trim())
        }
        // An absolute-form target (`GET http://host/path`) is legal in HTTP/1.1
        // and some clients send it; the proxy only wants the path and query.
        val target = parts[1].removePrefix("http://").removePrefix("https://")
        return RequestHead(parts[0], target, parts.getOrElse(2) { "HTTP/1.1" }, headers)
    }

    private fun readBody(input: InputStream, head: RequestHead): BodySource {
        val chunked = head.headers["transfer-encoding"]
            ?.any { it.contains("chunked", ignoreCase = true) } == true
        // Both paths go through `BoundedInputStream`, and both have to: it is the
        // thing that refuses to close the client socket out from under the
        // keep-alive loop.
        if (chunked) return BodySource.ofChunked(BoundedInputStream(input, Long.MAX_VALUE))
        val declared = head.headers["content-length"]?.firstOrNull()?.trim()?.toIntOrNull() ?: return BodySource.EMPTY
        return BodySource.ofStream(BoundedInputStream(input, declared.toLong()), declared)
    }

    private fun handleControl(method: String, path: String, body: BodySource, output: OutputStream) {
        fun json(status: Int, payload: String) {
            val bytes = payload.toByteArray(Charsets.UTF_8)
            val head = buildString {
                append("HTTP/1.1 ").append(status).append(' ').append(reasonFor(status)).append("\r\n")
                append("content-type: application/json; charset=utf-8\r\n")
                append("content-length: ").append(bytes.size).append("\r\n")
                // The control plane is answered by this proxy rather than by
                // the upstream, so it never goes out through `forward` and never
                // picks up the framing that path adds. Saying so here is the
                // only chance: without it the connection closes silently and a
                // client that reused it finds it dead.
                append("connection: close\r\n")
                append("cache-control: no-store\r\n\r\n")
            }
            output.write(head.toByteArray(Charsets.ISO_8859_1))
            output.write(bytes)
            output.flush()
        }

        if (path == "/__ocm/target" && method == "GET") {
            json(200, """{"target":${quote(target())},"secureTransport":$secureTransport}""")
            return
        }

        if (path == "/__ocm/target" && method == "PUT") {
            val text = readSmallBody(body)
            if (text == null) {
                json(400, """{"error":"body_too_large"}""")
                return
            }
            val next = extractTarget(text)
            if (next == null) {
                json(400, """{"error":"target_must_be_a_string"}""")
                return
            }
            val applied = try {
                setTarget(next)
            } catch (error: InvalidTargetError) {
                json(400, """{"error":"invalid_target","message":${quote(error.message ?: "")}}""")
                return
            }
            json(200, """{"target":${quote(applied)}}""")
            return
        }

        json(404, """{"error":"unknown_control_endpoint"}""")
    }

    /** Read a control body, refusing one too large to be a control body. */
    private fun readSmallBody(body: BodySource): String? {
        if (body.framing == BodyFraming.LENGTH && body.declaredLength > MAX_CONTROL_BODY) return null
        if (body.framing == BodyFraming.CHUNKED) return null
        val out = ByteArrayOutputStream()
        body.writeTo(out)
        return if (out.size() > MAX_CONTROL_BODY) null else out.toString(Charsets.UTF_8.name())
    }

    /** Forward one request. Returns true when the response was an open-ended
     *  stream, which owns its connection until it ends. */
    private fun forward(head: RequestHead, fullPath: String, input: InputStream, output: OutputStream): Boolean {
        val address = upstream.get()
        val origin = targetOrigin(address)
        // The server may be mounted under a sub-path, so the request target is
        // applied to it rather than replacing it.
        val requestTarget = joinServerUrl(address.path, fullPath)

        val requestBody = readBody(input, head)
        val response = try {
            sendUpstream(head.method, address, requestTarget, buildUpstreamHeaders(head.headers, origin), requestBody)
        } catch (error: Throwable) {
            // Nothing has been written downstream yet: `sendUpstream` either
            // returns a complete response head or throws before there is one.
            onError?.invoke(error, fullPath)
            writeError(output, 502, "upstream_unreachable", "${origin.origin} did not answer")
            return false
        }

        val hasBody = response.status !in 100..199 && response.status != 204 &&
            response.status != 304 && head.method != "HEAD"
        val isStream = hasBody && response.isOpenEnded

        if (isStream) {
            // Only a stream needs watching. The request body has been consumed
            // from `input` by now, so a thread blocked on it is how a client that
            // navigates away mid-stream gets noticed - without it the proxy sits
            // in a read from a terminal nobody is listening to any more, and that
            // session stays open on the server until its own heartbeat gives up.
            //
            // This is also why a stream ends the connection: the watcher is
            // holding `input`, and a thread still holding it cannot be stopped
            // without closing the socket. A stream has the whole connection to
            // itself anyway.
            Thread({
                try {
                    while (input.read() >= 0) {
                        // waiting for the client to hang up
                    }
                } catch (_: Exception) {
                    // the connection is gone, which is the point
                }
                response.close()
            }, "ocm-proxy-downstream").apply { isDaemon = true; start() }
        }

        response.use {
            val downstream = buildDownstreamHeaders(response.headers, origin, secureTransport)
            // Framing is decided once, here, and the body is re-emitted chunk by
            // chunk so a stream of unknown length reaches the WebView live.
            downstream.remove("content-length")
            downstream.remove("transfer-encoding")
            downstream["x-ocm-proxy-target"] = listOf(origin.origin)

            val head2 = buildString {
                append("HTTP/1.1 ").append(response.status).append(' ')
                append(response.reason.ifEmpty { reasonFor(response.status) }).append("\r\n")
                if (hasBody) append("transfer-encoding: chunked\r\n")
                // Say what we are about to do. A response that silently closes
                // the connection is a response the browser will reuse and then
                // find dead.
                if (head.wantsClose || isStream) append("connection: close\r\n")
                for ((name, values) in downstream) {
                    if (values.isEmpty()) continue
                    // Repeated headers (set-cookie especially) must stay
                    // repeated: joining them onto one line changes their meaning.
                    for (value in values) append(name).append(": ").append(value).append("\r\n")
                }
                append("\r\n")
            }
            output.write(head2.toByteArray(Charsets.ISO_8859_1))
            output.flush()
            if (hasBody) {
                response.copyBodyTo(ChunkedSink(output))
                output.write("0\r\n\r\n".toByteArray(Charsets.ISO_8859_1))
                output.flush()
            }
        }
        return isStream
    }

    /** `Transfer-Encoding: chunked` framing on the way back to the browser.
     *
     *  The flush here is the load-bearing one: this is where bytes land on the
     *  buffered socket the WebView is reading, so a frame is pushed out as it
     *  arrives rather than sitting in a buffer until the response ends. A test
     *  that proves removing it breaks the terminal stream lives in ProxyTest. */
    private class ChunkedSink(private val output: OutputStream) : OutputStream() {
        override fun write(b: Int) {
            write(byteArrayOf(b.toByte()), 0, 1)
        }

        override fun write(buffer: ByteArray, offset: Int, length: Int) {
            if (length == 0) return
            output.write("${length.toString(16)}\r\n".toByteArray(Charsets.ISO_8859_1))
            output.write(buffer, offset, length)
            output.write("\r\n".toByteArray(Charsets.ISO_8859_1))
            output.flush()
        }

        override fun flush() = output.flush()
    }

    private fun writeError(output: OutputStream, status: Int, code: String, message: String) {
        val bytes = """{"error":${quote(code)},"message":${quote(message)}}""".toByteArray(Charsets.UTF_8)
        val head = buildString {
            append("HTTP/1.1 ").append(status).append(' ').append(reasonFor(status)).append("\r\n")
            append("content-type: application/json; charset=utf-8\r\n")
            append("content-length: ").append(bytes.size).append("\r\n")
            // `forward` returns false right after this, so the connection is
            // about to go. An error the caller was told nothing about closing is
            // a connection they will reuse.
            append("connection: close\r\n\r\n")
        }
        output.write(head.toByteArray(Charsets.ISO_8859_1))
        output.write(bytes)
        output.flush()
    }
}

/**
 * Pull `target` out of a small JSON object.
 *
 * Hand-rolled because the whole module is dependency-free, and deliberately
 * narrow: it reads one known string key and gives up on anything it does not
 * recognise rather than pretending to be a parser. A real JSON library would
 * mean shipping one to an APK that has exactly one document to read.
 */
internal fun extractTarget(text: String): String? {
    val trimmed = text.trim()
    if (!trimmed.startsWith("{")) return null
    val key = "\"target\""
    val at = trimmed.indexOf(key)
    if (at < 0) return null
    val colon = trimmed.indexOf(':', at + key.length)
    if (colon < 0) return null
    val rest = trimmed.substring(colon + 1).trimStart()
    if (!rest.startsWith("\"")) return null

    val builder = StringBuilder()
    var index = 1
    while (index < rest.length) {
        val c = rest[index]
        when {
            c == '\\' && index + 1 < rest.length -> {
                builder.append(rest[index + 1])
                index += 2
            }
            c == '"' -> return builder.toString()
            else -> {
                builder.append(c)
                index++
            }
        }
    }
    return null
}

private fun quote(value: String): String {
    val builder = StringBuilder("\"")
    for (c in value) {
        when (c) {
            '"' -> builder.append("\\\"")
            '\\' -> builder.append("\\\\")
            '\n' -> builder.append("\\n")
            '\r' -> builder.append("\\r")
            '\t' -> builder.append("\\t")
            else -> if (c < ' ') builder.append("\\u%04x".format(c.code)) else builder.append(c)
        }
    }
    return builder.append('"').toString()
}

private fun reasonFor(status: Int): String = when (status) {
    200 -> "OK"
    204 -> "No Content"
    304 -> "Not Modified"
    400 -> "Bad Request"
    404 -> "Not Found"
    502 -> "Bad Gateway"
    else -> "Status"
}