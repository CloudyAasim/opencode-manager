package dev.opencodemanager.app

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import dev.opencodemanager.proxy.InvalidTargetError
import dev.opencodemanager.proxy.ProxyServer
import dev.opencodemanager.proxy.normalizeServerUrl
import dev.opencodemanager.proxy.toUpstreamUrl

/**
 * One WebView, pointed at a loopback proxy.
 *
 * The WebView never talks to the server directly. It is loaded from
 * `http://127.0.0.1:<port>`, and the proxy forwards everything to whichever
 * server the person chose. That indirection is the whole point: better-auth's
 * session cookie is `SameSite=Lax`, so a WebView loaded straight from a remote
 * origin drops it on every authenticated call and comes back 401 with nothing
 * on screen to explain it. Being same-origin makes the cookie first-party and
 * the server's origin checks pass without changing the server.
 *
 * Deliberately not Capacitor or any other wrapper: those serve the app's assets
 * through the WebView client rather than over a socket, which takes the origin
 * with them, and `text/event-stream` has no reliable flush guarantee on that
 * path. A live terminal is the one thing this app must not get wrong.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var preferences: ServerPreferences
    private var proxy: ProxyServer? = null

    /** Kept so `shouldOverrideUrlLoading` and the download handler agree. */
    private var origin: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        preferences = ServerPreferences(this)

        webView = WebView(this)
        configure(webView)
        setContentView(layout())

        val saved = preferences.serverUrl
        if (saved == null) {
            // Nothing to open yet. Asking is the only honest first screen: a
            // default would silently point the app at somebody's server.
            askForServer()
        } else {
            open(saved)
        }
    }

    private fun layout(): View {
        val root = android.widget.FrameLayout(this)
        root.addView(
            webView,
            android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        // A single affordance, kept faint and out of the way. There is no action
        // bar because the page has its own header and two of them is worse than
        // none; but changing server has to be reachable, because the reason a
        // person installed this is that servers move.
        val menu = android.widget.ImageButton(this).apply {
            setImageResource(R.drawable.ic_menu)
            alpha = 0.55f
            setBackgroundColor(0x00000000)
            contentDescription = getString(R.string.server_dialog_title)
            setOnClickListener { showMenu() }
        }
        val size = (40 * resources.displayMetrics.density).toInt()
        val margin = (8 * resources.displayMetrics.density).toInt()
        root.addView(
            menu,
            android.widget.FrameLayout.LayoutParams(size, size).apply {
                gravity = android.view.Gravity.TOP or android.view.Gravity.END
                topMargin = margin
                marginEnd = margin
            },
        )
        return root
    }

    private fun configure(view: WebView) {
        view.settings.apply {
            javaScriptEnabled = true
            // The app is a single-page app; without this it has no place to
            // keep a draft, a scroll position, or the server choice.
            domStorageEnabled = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            // Nothing in this app is a local file, and letting a remote page read
            // one would hand it the whole device to a compromised server.
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            // Every request is same-origin by construction, so third-party
            // cookies can only come from a page that has already left it.
            setAcceptThirdPartyCookies(view, false)
        }
        view.overScrollMode = View.OVER_SCROLL_NEVER
        view.isVerticalScrollBarEnabled = false

        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (isOwnOrigin(url)) return false
                // Following this would take the page off the proxy origin and
                // back into the cross-origin case the proxy exists to avoid,
                // silently - the UI would keep working and every request would
                // start failing with 401.
                openExternally(url)
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                syncServerSelectionIntoThePage(view)
            }
        }

        view.setDownloadListener { url, _, _, _, _ ->
            // A download cannot be handed to the browser while it is addressed
            // to loopback, so it is rewritten back to the real server first.
            externalize(url)?.let { openExternally(it) }
        }
    }

    /**
     * The page has its own server preference (`ocm.serverUrl`), read at module
     * load, and the shell has one here. Two answers to the same question is how
     * a person ends up looking at a server's login page after typing their
     * password into the real one. So the shell's answer is written into the
     * page's storage, and the page reloads if that actually changed anything -
     * which is once, on the first load or after a change, and never again.
     */
    private fun syncServerSelectionIntoThePage(view: WebView) {
        val want = preferences.serverUrl ?: return
        val script = """
            (function () {
              var want = ${jsString(want)};
              if (localStorage.getItem('ocm.serverUrl') === want) return 'same';
              localStorage.setItem('ocm.serverUrl', want);
              return 'changed';
            })()
        """.trimIndent()
        view.evaluateJavascript(script) { result ->
            if (result == "\"changed\"") view.reload()
        }
    }

    private fun open(serverUrl: String) {
        val normalized = normalizeServerUrl(serverUrl)
        val address = try {
            toUpstreamUrl(normalized)
        } catch (error: InvalidTargetError) {
            // Refused before anything was bound, with the reason attached: a
            // typo in a settings box should read as a typo, not as a crash or
            // as "the app is broken".
            askForServer(getString(R.string.error_bad_address, error.message ?: normalized))
            return
        }

        stopProxy()
        val created = ProxyServer(normalized, onError = { error, path ->
            runOnUiThread {
                Log.w(TAG, "proxy: ${error.javaClass.simpleName} $path")
            }
        })
        val bound = try {
            created.start(preferences.port)
        } catch (error: Exception) {
            askForServer(getString(R.string.error_proxy_failed, error.message ?: "unknown"))
            return
        }

        preferences.port = bound
        proxy = created
        // The address goes back as the origin the proxy serves, which is what
        // the page is loaded from.
        origin = "http://127.0.0.1:$bound"
        webView.loadUrl("$origin/")
    }

    private fun isOwnOrigin(url: Uri): Boolean =
        url.scheme == "http" && url.host == "127.0.0.1" && url.port == proxy?.port

    /** A loopback URL turned back into the server URL it is proxying for. */
    private fun externalize(url: String): Uri? {
        val parsed = runCatching { Uri.parse(url) }.getOrNull() ?: return null
        if (parsed.host != "127.0.0.1") return parsed
        val target = preferences.serverUrl ?: return null
        val path = parsed.path ?: "/"
        if (path.startsWith("/__ocm/")) return null
        val address = runCatching { toUpstreamUrl(target) }.getOrNull() ?: return null
        val suffix = if (parsed.query != null) "?${parsed.query}" else ""
        return Uri.parse(address.base + path + suffix)
    }

    private fun openExternally(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, uri.toString(), Toast.LENGTH_LONG).show()
        }
    }

    private fun showMenu() {
        AlertDialog.Builder(this)
            .setItems(
                arrayOf<CharSequence>(
                    getString(R.string.server_dialog_change),
                    getString(R.string.app_name) + " — " + (preferences.serverUrl ?: ""),
                )
            ) { _, which ->
                when (which) {
                    0 -> askForServer()
                    1 -> preferences.serverUrl?.let { openExternally(Uri.parse(it)) }
                }
            }
            .show()
    }

    private fun askForServer(errorMessage: String? = null) {
        val input = android.widget.EditText(this).apply {
            hint = getString(R.string.server_dialog_hint)
            setSingleLine()
            setText(preferences.serverUrl ?: "")
        }
        val container = android.widget.FrameLayout(this).apply {
            val pad = (20 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad / 2, pad, 0)
            addView(
                input,
                android.widget.FrameLayout.LayoutParams(
                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                    android.widget.FrameLayout.LayoutParams.WRAP_CONTENT,
                ),
            )
        }

        val builder = AlertDialog.Builder(this)
            .setTitle(R.string.server_dialog_title)
            .setMessage(R.string.server_dialog_message)
            .setView(container)
            .setPositiveButton(R.string.server_dialog_save) { _, _ ->
                val typed = input.text.toString().trim()
                if (typed.isEmpty()) {
                    Toast.makeText(this, R.string.server_dialog_hint, Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                val normalized = normalizeServerUrl(typed)
                preferences.serverUrl = normalized
                open(normalized)
            }
            .setNegativeButton(R.string.server_dialog_cancel, null)

        if (errorMessage != null) builder.setMessage(errorMessage)
        builder.show()
    }

    private fun stopProxy() {
        proxy?.stop()
        proxy = null
    }

    /**
     * Back goes back through the app's own history, and out of the app when
     * there is none. Overriding this rather than registering a callback is not
     * a style choice: it keeps the app off `androidx.activity`.
     */
    @Deprecated("The platform callback still fires for this app, which opts out of predictive back")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        stopProxy()
        webView.destroy()
        super.onDestroy()
    }

    /** A JSON string literal, so an address can never break out of the script. */
    private fun jsString(value: String): String {
        val out = StringBuilder("\"")
        for (c in value) {
            when (c) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\n' -> out.append("\\n")
                '\r' -> out.append("\\r")
                else -> if (c < ' ') out.append("\\u%04x".format(c.code)) else out.append(c)
            }
        }
        return out.append('"').toString()
    }

    private companion object {
        const val TAG = "OpenCodeManager"
    }
}