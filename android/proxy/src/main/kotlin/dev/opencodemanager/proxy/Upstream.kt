package dev.opencodemanager.proxy

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.Closeable
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import javax.net.ssl.SNIHostName
import javax.net.ssl.SSLParameters
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/**
 * A minimal HTTP/1.1 client, written against raw sockets rather than
 * `HttpURLConnection` or OkHttp. Three requirements rule the others out:
 *
 *  - **Any method.** `HttpURLConnection` silently downgrades `PATCH` to `POST`.
 *  - **Real streaming.** `text/event-stream` must reach the WebView frame by
 *    frame. Any layer that collects the body first turns a live terminal into a
 *    frozen one with no error to explain it.
 *  - **Full control of framing.** `HttpURLConnection` manages `Host`,
 *    `Content-Length` and `Transfer-Encoding` itself and throws if you set them.
 *
 * And because the streaming path is code in this repository rather than a
 * wrapper around someone else's, an SSE frame can be asserted to arrive when it
 * was sent instead of merely assumed to.
 */

internal const val CONNECT_TIMEOUT_MS = 15_000

/** How long a *silent* upstream has to send its status line and headers.
 *
 *  Non-zero, because a server that accepts the connection and then says nothing
 *  forever should fail rather than hang the WebView. Cleared to 0 before the
 *  body is read: a live stream is silent for minutes at a time, and cutting it
 *  on a read timeout would be the single most confusing failure this proxy could
 *  have. */
internal const val HEADERS_TIMEOUT_MS = 20_000

internal const val MAX_HEAD_BYTES = 64 * 1024
internal const val MAX_HEADERS = 200

class ProxyConnectionLost(message: String, cause: Throwable? = null) : java.io.IOException(message, cause)

/** How the request body is delimited. */
enum class BodyFraming { NONE, LENGTH, CHUNKED, EOF }

class BodySource private constructor(
    val framing: BodyFraming,
    /** Byte count when `framing` is `LENGTH`; -1 otherwise. */
    val declaredLength: Int,
    private val payload: ByteArray?,
    private val source: InputStream?,
) {
    /** Copy the body out, framing it for the wire. Never accumulates in memory. */
    fun writeTo(sink: OutputStream) {
        when (framing) {
            BodyFraming.NONE, BodyFraming.EOF -> Unit
            BodyFraming.LENGTH -> {
                payload?.let { sink.write(it) } ?: source?.use { it.copyTo(sink) }
            }
            BodyFraming.CHUNKED -> {
                val input = source ?: throw IllegalStateException("chunked body with no source")
                input.use { stream ->
                    while (true) {
                        val line = readLine(stream) ?: break
                        val size = parseChunkSize(line)
                        if (size == 0L) {
                            // Optional trailers, then the terminating blank line.
                            while (true) {
                                val trailer = readLine(stream) ?: break
                                if (trailer.isEmpty()) break
                            }
                            sink.write("0\r\n\r\n".toByteArray())
                            break
                        }
                        copyExactly(stream, sink, size)
                        readLine(stream) // the CRLF that follows the chunk data
                        sink.write("${size.toString(16)}\r\n".toByteArray())
                        sink.flush()
                    }
                }
            }
        }
        sink.flush()
    }

    companion object {
        val EMPTY = BodySource(BodyFraming.NONE, -1, null, null)
        fun ofBytes(data: ByteArray) = BodySource(BodyFraming.LENGTH, data.size, data, null)
        fun ofStream(source: InputStream, byteLength: Int) =
            BodySource(BodyFraming.LENGTH, byteLength, null, source)
        fun ofChunked(source: InputStream) = BodySource(BodyFraming.CHUNKED, -1, null, source)
    }
}

/** Read exactly `count` bytes. A stream that ends first is a broken upstream. */
private fun copyExactly(input: InputStream, sink: OutputStream, count: Long) {
    val buffer = ByteArray(16 * 1024)
    var remaining = count
    while (remaining > 0) {
        val wanted = minOf(remaining.toInt(), buffer.size)
        val read = input.read(buffer, 0, wanted)
        if (read < 0) throw ProxyConnectionLost("stream ended $remaining bytes early")
        sink.write(buffer, 0, read)
        remaining -= read
    }
}

private fun parseChunkSize(line: String): Long =
    line.substringBefore(';').trim().toLongOrNull(16)
        ?: throw ProxyConnectionLost("unreadable chunk size \"$line\"")

/** One header line, or null at a clean end of stream. Never more than 64 KiB. */
internal fun readLine(input: InputStream): String? {
    val bytes = java.io.ByteArrayOutputStream(128)
    while (true) {
        val c = input.read()
        if (c < 0) {
            return if (bytes.size() == 0) null else bytes.toString(Charsets.ISO_8859_1.name())
        }
        if (c == '\n'.code) break
        if (c != '\r'.code) bytes.write(c)
        if (bytes.size() > MAX_HEAD_BYTES) throw ProxyConnectionLost("header line exceeded 64 KiB")
    }
    return bytes.toString(Charsets.ISO_8859_1.name())
}

private class Head(
    val version: String,
    val status: Int,
    val reason: String,
    val headers: Map<String, List<String>>,
)

private fun readHead(input: InputStream): Head {
    val statusLine = readLine(input) ?: throw ProxyConnectionLost("connection closed before a response")
    val parts = statusLine.split(' ', limit = 3)
    if (parts.size < 2 || !parts[0].startsWith("HTTP/")) {
        throw ProxyConnectionLost("not an HTTP response: \"$statusLine\"")
    }
    val status = parts[1].toIntOrNull() ?: throw ProxyConnectionLost("unreadable status \"$statusLine\"")

    val headers = LinkedHashMap<String, MutableList<String>>()
    var count = 0
    while (true) {
        val line = readLine(input) ?: break
        if (line.isEmpty()) break
        if (++count > MAX_HEADERS) throw ProxyConnectionLost("more than $MAX_HEADERS response headers")
        val colon = line.indexOf(':')
        if (colon <= 0) continue
        headers.getOrPut(line.substring(0, colon).trim().lowercase()) { ArrayList(1) }
            .add(line.substring(colon + 1).trim())
    }
    return Head(parts[0], status, parts.getOrElse(2) { "" }, headers)
}

/**
 * A response head plus the socket it arrived on, so the body can still be
 * streamed. The caller owns the socket and must close it.
 */
class UpstreamResponse internal constructor(
    private val socket: Socket,
    private val input: BufferedInputStream,
    val status: Int,
    val reason: String,
    val headers: Map<String, List<String>>,
    requestWasHead: Boolean,
) : Closeable {
    /**
     * The socket's read timeout while the body streams.
     *
     * Exposed because "no read timeout once the head is in" is the invariant
     * that keeps a live terminal from being cut mid-thought, and a test that has
     * to wait twenty seconds to notice a timeout is not a test anyone will keep.
     * Zero means the stream is never cut for being quiet.
     */
    val readTimeoutMs: Int get() = socket.soTimeout
    private val chunked = headers.entries
        .firstOrNull { it.key == "transfer-encoding" }
        ?.value?.any { it.contains("chunked", ignoreCase = true) } == true
    private val contentLength = headers.entries
        .firstOrNull { it.key == "content-length" }
        ?.value?.firstOrNull()?.trim()?.toLongOrNull()

    private val bodyFraming = when {
        // 1xx other than 101 and the no-content statuses carry no body at all,
        // and a HEAD response carries none however it is framed.
        requestWasHead || status == 204 || status == 304 || (status in 100..199 && status != 101) ->
            BodyFraming.NONE
        chunked -> BodyFraming.CHUNKED
        contentLength != null -> BodyFraming.LENGTH
        // Neither delimiter: the body runs to the end of the connection.
        else -> BodyFraming.EOF
    }

    /**
     * How the body is delimited.
     *
     * Exposed because `CHUNKED` and `EOF` are what a live stream looks like, and
     * the caller has to treat those differently: a stream can still be
     * abandoned by the client at any moment, so the connection it is on cannot
     * be handed back to the keep-alive loop.
     */
    val framing: BodyFraming get() = bodyFraming

    /** True when the body may never end: a terminal, an event feed. */
    val isOpenEnded: Boolean get() = bodyFraming == BodyFraming.CHUNKED || bodyFraming == BodyFraming.EOF

    /**
     * Stream the body to `sink`, decoded.
     *
     * Nothing is accumulated here. Flushing is the sink's business, not this
     * method's - whoever writes bytes onto a buffered socket is the one who
     * knows whether they have reached the network yet - so a frame is pushed out
     * by the frame after it, once, at the place the bytes actually land.
     */
    fun copyBodyTo(sink: OutputStream) {
        when (bodyFraming) {
            BodyFraming.NONE -> Unit
            BodyFraming.LENGTH -> copyExactly(input, sink, contentLength!!)
            BodyFraming.EOF -> input.copyTo(sink)
            BodyFraming.CHUNKED -> {
                while (true) {
                    val line = readLine(input)
                        ?: throw ProxyConnectionLost("chunked stream ended without a terminator")
                    val size = parseChunkSize(line)
                    if (size == 0L) {
                        while (true) {
                            val trailer = readLine(input) ?: break
                            if (trailer.isEmpty()) break
                        }
                        break
                    }
                    copyExactly(input, sink, size)
                    readLine(input)
                }
            }
        }
        sink.flush()
    }

    override fun close() {
        try {
            socket.close()
        } catch (_: Exception) {
            // A socket that is already gone is not interesting.
        }
    }
}

private fun isIpLiteral(host: String): Boolean {
    if (host.contains(':')) return true
    val parts = host.split('.')
    return parts.size == 4 && parts.all { part -> part.toIntOrNull()?.let { it in 0..255 } == true }
}

private fun connect(address: ServerAddress, connectTimeoutMs: Int): Socket {
    val scheme = address.scheme
    val port = address.port
    // An IPv6 literal carries its brackets in the authority; `InetAddress` wants
    // them gone.
    val bareHost = if (address.host.startsWith("[")) {
        address.host.substring(1, address.host.length - 1)
    } else {
        address.host
    }

    if (scheme == "https") {
        val socket = (SSLSocketFactory.getDefault() as SSLSocketFactory).createSocket() as SSLSocket
        val parameters = SSLParameters()
        // A certificate for the wrong name becomes a handshake failure rather
        // than a successful connection to whoever answered - the guarantee Node's
        // `https.request` gives for free.
        parameters.endpointIdentificationAlgorithm = "HTTPS"
        // SNI is required for virtual hosting and rejected outright for an IP
        // literal, so it is set only when there is a name to send.
        if (!isIpLiteral(bareHost)) {
            parameters.serverNames = listOf(SNIHostName(bareHost))
        }
        socket.sslParameters = parameters
        socket.connect(InetSocketAddress(bareHost, port), connectTimeoutMs)
        socket.soTimeout = HEADERS_TIMEOUT_MS
        socket.startHandshake()
        return socket
    }

    val socket = Socket()
    socket.tcpNoDelay = true
    socket.connect(InetSocketAddress(bareHost, port), connectTimeoutMs)
    socket.soTimeout = HEADERS_TIMEOUT_MS
    return socket
}

/**
 * Send one request and return its response head with the socket still open.
 *
 * `requestTarget` is the path and query as the browser wrote it; it is sent
 * unparsed, so a percent-encoded path stays exactly as encoded on the way through
 * rather than being decoded and re-encoded.
 *
 * 1xx responses are informational and a real response follows, so they are
 * consumed; 101 is a protocol switch, after which there is nothing to read.
 */
fun sendUpstream(
    method: String,
    address: ServerAddress,
    requestTarget: String,
    headers: Map<String, List<String>>,
    body: BodySource,
    connectTimeoutMs: Int = CONNECT_TIMEOUT_MS,
): UpstreamResponse {
    val target = if (requestTarget.startsWith("/")) requestTarget else "/$requestTarget"

    val socket = connect(address, connectTimeoutMs)
    try {
        val input = BufferedInputStream(socket.getInputStream(), 32 * 1024)
        val output = BufferedOutputStream(socket.getOutputStream(), 32 * 1024)

        val head = StringBuilder()
            .append(method).append(' ')
            .append(target)
            .append(" HTTP/1.1\r\n")
        var sawHost = false
        for ((name, values) in headers) {
            if (values.isEmpty()) continue
            if (name == "host") sawHost = true
            head.append(name).append(": ").append(values.joinToString(", ")).append("\r\n")
        }
        if (!sawHost) head.append("host: ").append(address.authority).append("\r\n")
        when (body.framing) {
            BodyFraming.LENGTH -> head.append("content-length: ").append(body.declaredLength).append("\r\n")
            BodyFraming.CHUNKED -> head.append("transfer-encoding: chunked\r\n")
            else -> Unit
        }
        head.append("\r\n")

        output.write(head.toString().toByteArray(Charsets.ISO_8859_1))
        output.flush()
        body.writeTo(output)

        val response = readResponseHead(socket, input, method == "HEAD")
        // The body of a stream must never be cut by a read timeout.
        socket.soTimeout = 0
        return response
    } catch (error: Throwable) {
        try {
            socket.close()
        } catch (_: Exception) {
            // already gone
        }
        throw error
    }
}

private fun readResponseHead(
    socket: Socket,
    input: BufferedInputStream,
    requestWasHead: Boolean,
): UpstreamResponse {
    while (true) {
        val head = readHead(input)
        if (head.status == 101 || head.status !in 100..199) {
            return UpstreamResponse(
                socket, input, head.status, head.reason, head.headers, requestWasHead,
            )
        }
    }
}