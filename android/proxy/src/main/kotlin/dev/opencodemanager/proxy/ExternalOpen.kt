package dev.opencodemanager.proxy

/**
 * Whether a URL that is *not* this app's own origin is safe to hand to the
 * operating system.
 *
 * `MainActivity.shouldOverrideUrlLoading` routes every off-origin navigation to
 * `Intent.ACTION_VIEW`, and the page chooses that URL. Without a check, the page
 * can hand Android any scheme at all:
 *
 *   - `file://` - opens this app's own private files in whatever handles them;
 *   - `content://` - a content provider, which is an exported surface;
 *   - `intent://...#Intent;component=...;end` - launches an arbitrary component.
 *     This is the one that matters on Android specifically: it is not a document
 *     link, it is a request to start something.
 *
 * The threat model is already stated elsewhere in the client -
 * `allowFileAccess = false` is turned off precisely so that "letting a remote
 * page read one would hand it the whole device to a compromised server". That
 * setting governs the WebView's own file access; it does not govern an intent
 * the shell launches afterwards. This is the same rule, applied to the other
 * surface.
 *
 * Only http and https leave the machine through the browser, which is the case
 * the call exists for. `electron-app/src/window.ts` draws the same line for
 * `shell.openExternal`, for the same reason - there the exposure is a
 * world-readable `/proc/<pid>/cmdline`, here it is a component launch.
 *
 * Kept in this module, and taking a scheme rather than an `android.net.Uri`,
 * so it is provable on a plain JDK with no device or SDK - which is the reason
 * the proxy is a plain JVM module at all.
 */
fun isExternallyOpenableScheme(scheme: String?): Boolean {
    if (scheme == null) return false
    val normalized = scheme.trim().lowercase()
    if (normalized.isEmpty()) return false
    return normalized == "http" || normalized == "https"
}
