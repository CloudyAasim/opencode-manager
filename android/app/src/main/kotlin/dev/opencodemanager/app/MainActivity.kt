package dev.opencodemanager.app

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
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
        // After `setContentView`, and that ordering is not a style choice.
        // `window.insetsController` reads like a nullable getter, but
        // `PhoneWindow` dereferences the decor view inside it and throws
        // NullPointerException when there is not one yet. The safe-call
        // operator does not help, because the throw happens inside the getter
        // rather than at the call site. `setContentView` is what builds the
        // decor. Called one line earlier, the app dies on launch.
        hideTheStatusBar()

        val saved = preferences.serverUrl
        if (saved == null) {
            // Nothing to open yet. Asking is the only honest first screen: a
            // default would silently point the app at somebody's server.
            askForServer()
        } else {
            open(saved)
        }
    }

    /**
     * The status bar is the system's, and it is in the way.
     *
     * Android 15 lays every app out edge to edge, so the page underneath runs
     * the full height of the screen and the status bar floats over the top of
     * it - clock, signal, battery, on top of the page's own header. The theme
     * painted the bar the same colour as the background, which Android 15
     * ignores outright, so what looked like the app having a title bar was the
     * system's, drawn on top and never asked to go away.
     *
     * Only the status bar is hidden. The navigation bar stays: on a gesture
     * device it is the one thing that says where the app ends, and the page
     * measures its own bottom safe-area padding against it. Hiding that too
     * would change layout the sheet's footer depends on, in a direction
     * nothing on this machine is able to test.
     *
     * Swiping from the top edge brings the bar back for a moment. That is the
     * platform refusing to let it become unreachable, not a setting of ours.
     *
     * The platform API rather than `WindowInsetsControllerCompat`, because this
     * app carries no AndroidX dependency and a one-line system-bar request is
     * not worth a support library.
     *
     * Must be called once the decor view exists - see the note at the call
     * site in `onCreate`.
     */
    private fun hideTheStatusBar() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.apply {
                hide(WindowInsets.Type.statusBars())
                systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        }
    }

    /**
     * The bars come back on their own, so the request has to be re-issued.
     *
     * Android restores them whenever the window regains focus - after the
     * notification shade, after a permission dialog, after the launcher. A
     * request made once in `onCreate` survives none of those, and an app that
     * hides its status bar and then shows it halfway through a session reads
     * as broken rather than as intentional.
     */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideTheStatusBar()
    }

    private fun layout(): View {
        // Nothing floats over the page.
        //
        // This used to be a WebView with a 55%-alpha, background-less
        // ImageButton pinned to the top-right corner - which is the one place a
        // page is guaranteed to have something. On the login screen it sat over
        // the language toggle; on every other screen it sat over the page's own
        // header. Being faint and borderless is what made it look like a
        // rendering artefact rather than a control, and it could not be moved
        // because the shell has no idea what the page has put underneath it.
        //
        // So the shell stopped drawing it. "Change server" is rendered by the
        // login page itself, in the footer slot that layout already provides,
        // through the bridge below. The page knows its own layout, so the
        // control cannot land on top of anything, and it is only reachable
        // where it belongs: before anyone has signed in.
        return android.widget.FrameLayout(this).apply {
            addView(
                webView,
                android.widget.FrameLayout.LayoutParams(
                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                ),
            )
        }
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

        // The page learns that a shell is around it by finding this object, and
        // renders its own "change server" affordance only when it is there. That
        // is what keeps the browser and desktop builds free of a control that
        // would do nothing for them.
        //
        // Exposing a bridge rather than injecting DOM is deliberate: the page
        // re-renders, and an element planted in it from outside gets wiped, or
        // worse, ends up duplicated. A method cannot go stale.
        //
        // On the risk of `addJavascriptInterface`: it is reachable from any
        // script in this WebView, and the only script that runs here is the
        // user's own server's app, which this proxy already forwards every byte
        // of. The exposed method opens a dialog the person then fills in - it
        // cannot read anything, cannot navigate, and cannot reach the network.
        // An attacker who could call it could already replace the login page.
        view.addJavascriptInterface(HostBridge(), "OCMAndroidHost")

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
     * Take the server address away from the page rather than handing it over.
     *
     * The page is served from the proxy origin and everything it asks for is
     * forwarded, so the only correct base for it is "the origin I was served
     * from" - the empty string, which is what `resolveServerUrl` falls back to.
     * Writing the upstream address into the page's own `ocm.serverUrl` made it
     * build absolute, cross-origin URLs instead, and those are refused twice
     * over: the proxy narrows CSP to `connect-src 'self'`, and a `SameSite=Lax`
     * session cookie would not ride on them anyway. The result was the whole
     * app reporting itself offline against a server it could demonstrably reach.
     *
     * Removing rather than setting empty is deliberate: a stored empty string
     * and an absent key both fall through to `config.js` and `VITE_API_URL`,
     * but only one of them also leaves nothing on screen in the settings panel
     * suggesting the page is choosing its own server. The shell owns that
     * choice - it has its own dialog and its own storage - and duplicating it
     * into the page is what caused this.
     *
     * The page's settings panel can still write the key if someone types into
     * it there. That fails safe rather than open: the proxy's CSP blocks the
     * resulting cross-origin call, so the outcome is the offline page again
     * rather than a credential sent somewhere it should not go.
     */
    private fun syncServerSelectionIntoThePage(view: WebView) {
        val script = """
            (function () {
              if (localStorage.getItem('ocm.serverUrl') === null) return 'absent';
              localStorage.removeItem('ocm.serverUrl');
              return 'removed';
            })()
        """.trimIndent()
        view.evaluateJavascript(script) { result ->
            // Only when something was actually there, so a launch does not
            // reload forever: after the removal the key is gone for good.
            if (result == "\"removed\"") view.reload()
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
        val created = ProxyServer(
            normalized,
            onError = { error, path ->
                runOnUiThread { Log.w(TAG, "proxy: ${error.javaClass.simpleName} $path") }
            },
            // The proxy worked and relayed something the app needs to be able to
            // say: a failure, or a cookie. On a phone there is no debugger, so
            // this log is the only account of what actually crossed the wire.
            onRelay = { status, path, cookies ->
                val suffix = if (cookies.isEmpty()) "" else " $cookies"
                Log.i(TAG, "relay: $status $path$suffix")
            },
        )
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

    /**
     * What the page is allowed to ask the shell to do.
     *
     * One method, because there is one thing the page cannot do itself: the
     * server address lives in the shell's storage, not the page's, so the page
     * has no way to change it. Everything else the page already does over HTTP
     * through the proxy.
     *
     * `@JavascriptInterface` methods are invoked on a WebView-owned thread, so
     * anything touching a dialog has to be posted to the UI thread.
     */
    private inner class HostBridge {
        @android.webkit.JavascriptInterface
        fun changeServer() {
            runOnUiThread { askForServer() }
        }
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

    private companion object {
        const val TAG = "OpenCodeManager"
    }
}