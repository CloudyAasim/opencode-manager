package dev.opencodemanager.app

import android.app.Application
import android.webkit.WebView

/**
 * The one place that must run before any WebView exists.
 *
 * `setDataDirectorySuffix` has to happen before the first WebView is created,
 * and an Application is the only place guaranteed to be early enough. Without
 * it a second WebView process - which `WebView` will happily start - races this
 * one onto the same data directory and crashes the app on launch.
 */
class OpenCodeApp : Application() {
    override fun onCreate() {
        super.onCreate()
        WebView.setDataDirectorySuffix("opencode-manager")
    }
}