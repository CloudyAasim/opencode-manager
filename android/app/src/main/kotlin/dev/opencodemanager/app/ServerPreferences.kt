package dev.opencodemanager.app

import android.content.Context
import android.content.SharedPreferences

/**
 * The two things the shell has to remember between launches: which server the
 * person chose, and which loopback port the proxy bound to.
 *
 * The port is not a detail. The WebView's origin is `http://127.0.0.1:<port>`,
 * and an origin is what localStorage and cookies are keyed on - so a different
 * port every launch means the person is silently signed out every time they open
 * the app, with nothing on screen to say why. Persisting the bound port is what
 * makes the session last.
 */
class ServerPreferences(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("opencode-manager", Context.MODE_PRIVATE)

    /** The upstream server, normalized, or `null` when nothing has been chosen. */
    var serverUrl: String?
        get() = prefs.getString(KEY_SERVER, null)?.takeIf { it.isNotEmpty() }
        set(value) {
            prefs.edit().apply {
                if (value.isNullOrEmpty()) remove(KEY_SERVER) else putString(KEY_SERVER, value)
            }.apply()
        }

    var port: Int
        get() = prefs.getInt(KEY_PORT, DEFAULT_PORT)
        set(value) = prefs.edit().putInt(KEY_PORT, value).apply()

    companion object {
        private const val KEY_SERVER = "serverUrl"
        private const val KEY_PORT = "proxyPort"

        /**
         * In the dynamic range, so it does not collide with the server ports a
         * developer is likely to be running locally.
         */
        const val DEFAULT_PORT = 47831
    }
}