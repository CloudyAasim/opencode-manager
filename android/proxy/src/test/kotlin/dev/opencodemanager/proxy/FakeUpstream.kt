package dev.opencodemanager.proxy

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** What a fake upstream saw, so a test can assert on what the proxy actually
 *  sent rather than on what it was asked to send. */
data class RecordedRequest(
    val method: String,
    val target: String,
    val headers: Map<String, List<String>>,
    val body: ByteArray,
) {
    fun header(name: String): String? = headers[name.lowercase()]?.firstOrNull()
    fun headerValues(name: String): List<String> = headers[name.lowercase()] ?: emptyList()
    val bodyText: String get() = String(body, Charsets.UTF_8)
}

/** A response read back off the proxy, with the chunked framing already undone. */
data class RecordedResponse(
    val statusLine: String,
    val headers: List<Pair<String, String>>,
    val body: ByteArray,
) {
    val status: Int get() = statusLine.split(' ').getOrNull(1)?.toIntOrNull() ?: 0
    fun header(name: String): String? =
        headers.firstOrNull { it.first.equals(name, ignoreCase = true) }?.second
    fun headerValues(name: String): List<String> =
        headers.filter { it.first.equals(name, ignoreCase = true) }.map { it.second }
    val bodyText: String get() = String(body, Charsets.UTF_8)
}

/**
 * A real HTTP server on a real loopback socket.
 *
 * Not a mock: the point of these tests is what happens to bytes on a wire, and a
 * stubbed socket would agree with a buffering proxy just as readily as with a
 * streaming one.
 */
class FakeUpstream(private val handler: (Socket, RecordedRequest) -> Unit) : java.io.Closeable {
    private val serverSocket = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
    private val connections = mutableListOf<Thread>()

    val port: Int get() = serverSocket.localPort
    val url: String get() = "http://127.0.0.1:$port"

    init {
        Thread({
            while (true) {
                val socket = try {
                    serverSocket.accept()
                } catch (_: Exception) {
                    return@Thread
                }
                val thread = Thread({
                    try {
                        handler(socket, readRequest(socket))
                    } catch (_: Exception) {
                        // A test that closes early is not a failure here.
                    } finally {
                        try {
                            socket.close()
                        } catch (_: Exception) {
                            // already gone
                        }
                    }
                })
                thread.isDaemon = true
                connections.add(thread)
                thread.start()
            }
        }, "fake-upstream").apply { isDaemon = true; start() }
    }

    private fun readRequest(socket: Socket): RecordedRequest {
        val input = socket.getInputStream()
        val requestLine = readLine(input) ?: throw IllegalStateException("no request line")
        val parts = requestLine.split(' ')
        val headers = LinkedHashMap<String, MutableList<String>>()
        while (true) {
            val line = readLine(input) ?: break
            if (line.isEmpty()) break
            val colon = line.indexOf(':')
            if (colon <= 0) continue
            headers.getOrPut(line.substring(0, colon).trim().lowercase()) { ArrayList(1) }
                .add(line.substring(colon + 1).trim())
        }
        val body = ByteArrayOutputStream()
        val declared = headers["content-length"]?.firstOrNull()?.trim()?.toIntOrNull() ?: 0
        val buffer = ByteArray(4096)
        var remaining = declared
        while (remaining > 0) {
            val read = input.read(buffer, 0, minOf(remaining, buffer.size))
            if (read < 0) break
            body.write(buffer, 0, read)
            remaining -= read
        }
        return RecordedRequest(parts[0], parts.getOrElse(1) { "/" }, headers, body.toByteArray())
    }

    override fun close() {
        try {
            serverSocket.close()
        } catch (_: Exception) {
            // already closed
        }
        connections.forEach { it.interrupt() }
    }
}

/** Write a complete response and close.
 *
 *  `content-length` is derived from the body unless the caller states one, so a
 *  fake that says `content-length: 0` and then writes bytes cannot make a
 *  correct proxy look broken. */
fun Socket.respond(
    status: String = "HTTP/1.1 200 OK",
    headers: List<Pair<String, String>> = emptyList(),
    body: String = "",
) {
    val bytes = body.toByteArray(Charsets.UTF_8)
    val declared = if (headers.any { it.first.equals("content-length", true) }) {
        headers
    } else {
        headers + ("content-length" to bytes.size.toString())
    }
    val head = buildString {
        append(status).append("\r\n")
        for ((name, value) in declared) append(name).append(": ").append(value).append("\r\n")
        append("\r\n")
    }
    getOutputStream().write(head.toByteArray(Charsets.ISO_8859_1))
    if (bytes.isNotEmpty()) getOutputStream().write(bytes)
    getOutputStream().flush()
}

/** Write response headers only, leaving the body to be streamed afterwards. */
fun Socket.respondHead(
    status: String = "HTTP/1.1 200 OK",
    headers: List<Pair<String, String>> = emptyList(),
) {
    val head = buildString {
        append(status).append("\r\n")
        for ((name, value) in headers) append(name).append(": ").append(value).append("\r\n")
        append("\r\n")
    }
    getOutputStream().write(head.toByteArray(Charsets.ISO_8859_1))
    getOutputStream().flush()
}

fun Socket.writeChunk(payload: String) {
    val bytes = payload.toByteArray(Charsets.UTF_8)
    getOutputStream().write("${bytes.size.toString(16)}\r\n".toByteArray(Charsets.ISO_8859_1))
    getOutputStream().write(bytes)
    getOutputStream().write("\r\n".toByteArray(Charsets.ISO_8859_1))
    getOutputStream().flush()
}

/** Read a whole response, undoing chunked framing if that is what arrived. */
fun Socket.readResponse(timeoutMs: Int = 5000): RecordedResponse {
    soTimeout = timeoutMs
    val input = getInputStream()
    val statusLine = readLine(input) ?: throw IllegalStateException("no status line")
    val headers = mutableListOf<Pair<String, String>>()
    while (true) {
        val line = readLine(input) ?: break
        if (line.isEmpty()) break
        val colon = line.indexOf(':')
        if (colon <= 0) continue
        headers.add(line.substring(0, colon).trim() to line.substring(colon + 1).trim())
    }

    val chunked = headers.any { it.first.equals("transfer-encoding", true) && it.second.contains("chunked", true) }
    val declared = headers.firstOrNull { it.first.equals("content-length", true) }?.second?.trim()?.toIntOrNull()

    val body: ByteArray = when {
        chunked -> readChunkedBody(input)
        declared != null -> ByteArrayOutputStream().also { out ->
            val buffer = ByteArray(4096)
            var remaining = declared
            while (remaining > 0) {
                val read = input.read(buffer, 0, minOf(remaining, buffer.size))
                if (read < 0) break
                out.write(buffer, 0, read)
                remaining -= read
            }
        }.toByteArray()
        else -> ByteArray(0)
    }
    return RecordedResponse(statusLine, headers, body)
}

/** Decode a chunked body until its terminator, blocking until each chunk lands.
 *
 *  Both CRLFs after the last-chunk are consumed: the one ending the `0` line and
 *  the one ending the (empty) trailer section. Leaving the second behind puts a
 *  stray CRLF in front of the next response on the same connection, and every
 *  assertion after the first is then reading shifted bytes - which looks like a
 *  proxy that answers once and hangs up, and is not. */
fun readChunkedBody(input: InputStream): ByteArray {
    val out = ByteArrayOutputStream()
    while (true) {
        val sizeLine = readLine(input) ?: break
        val size = sizeLine.substringBefore(';').trim().toInt(16)
        if (size == 0) {
            readLine(input)
            break
        }
        val buffer = ByteArray(size)
        var read = 0
        while (read < size) {
            val got = input.read(buffer, read, size - read)
            if (got < 0) throw IllegalStateException("chunk ended early")
            read += got
        }
        out.write(buffer)
        readLine(input)
    }
    return out.toByteArray()
}

/** Open a socket to the proxy and send a request. The caller reads the reply. */
fun openToProxy(proxyPort: Int, request: String, body: String = "", readTimeoutMs: Int = 5000): Socket {
    val socket = Socket()
    socket.connect(java.net.InetSocketAddress("127.0.0.1", proxyPort), 5000)
    socket.soTimeout = readTimeoutMs
    socket.getOutputStream().write(request.toByteArray(Charsets.ISO_8859_1))
    if (body.isNotEmpty()) socket.getOutputStream().write(body.toByteArray(Charsets.UTF_8))
    socket.getOutputStream().flush()
    return socket
}

fun simpleGet(path: String, extraHeaders: List<Pair<String, String>> = emptyList()): String =
    buildString {
        append("GET ").append(path).append(" HTTP/1.1\r\n")
        append("host: 127.0.0.1\r\n")
        for ((name, value) in extraHeaders) append(name).append(": ").append(value).append("\r\n")
        append("\r\n")
    }

/** Start a proxy pointed at `target`, registered to be stopped after the test. */
fun runningProxy(target: String, secureTransport: Boolean = false): ProxyServer {
    val proxy = ProxyServer(target, secureTransport)
    proxy.start()
    Runtime.getRuntime().addShutdownHook(Thread { proxy.stop() })
    return proxy
}

/** Wait for a latch that is only released by the test, failing on timeout. */
fun await(latch: CountDownLatch, seconds: Long = 5) {
    if (!latch.await(seconds, TimeUnit.SECONDS)) {
        throw AssertionError("the fake upstream was never released")
    }
}

fun writeRaw(output: OutputStream, text: String) {
    output.write(text.toByteArray(Charsets.ISO_8859_1))
    output.flush()
}