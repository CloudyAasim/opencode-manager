package dev.opencodemanager.app

import android.app.Instrumentation
import android.content.Intent
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * A page served from the Manager chooses the URL that
 * `shouldOverrideUrlLoading` hands to `Intent.ACTION_VIEW`. Without a check
 * first, that is a way to ask the operating system to launch any scheme:
 * `file://` reaches this app's own private files, and
 * `intent://...#Intent;component=...;end` is not a document link at all - it
 * is a request to start a component.
 *
 * The predicate is tested on a bare JVM in the `proxy` module. What cannot be
 * checked there is whether the WebView actually routes through it, which is
 * what this is for.
 *
 * The refusal cannot be read off the return value: `shouldOverrideUrlLoading`
 * returns `true` both when a URL is refused and when it is handed to a
 * handler. So these count the `startActivity` calls instead, and the http case
 * is a positive control - if that one stopped being observed, every refusal
 * below would pass for the wrong reason.
 */
@RunWith(AndroidJUnit4::class)
class ExternalNavigationTest {

    private class Request(private val uri: Uri) : WebResourceRequest {
        override fun getUrl(): Uri = uri
        override fun isForMainFrame(): Boolean = true
        override fun isRedirect(): Boolean = false
        override fun hasGesture(): Boolean = true
        override fun getMethod(): String = "GET"
        override fun getRequestHeaders(): MutableMap<String, String> = mutableMapOf()
    }

    private val instrumentation: Instrumentation = InstrumentationRegistry.getInstrumentation()
    private var scenario: ActivityScenario<MainActivity>? = null
    private var launches = 0
    private lateinit var monitor: Instrumentation.ActivityMonitor

    @Before
    fun setUp() {
        launches = 0
        monitor = object : Instrumentation.ActivityMonitor() {
            // `null` means "not handled here, carry on as normal" - which is
            // the point: the count is what matters, not what the system would
            // then do with a scheme no emulator has a handler for.
            override fun onStartActivity(intent: Intent): Instrumentation.ActivityResult? {
                launches += 1
                return null
            }
        }
        // After the launch, not before it: `ActivityScenario.launch` is itself
        // a `startActivity`, and counting it would put a constant in front of
        // every assertion below.
        scenario = ActivityScenario.launch(MainActivity::class.java)
        instrumentation.addMonitor(monitor)
        launches = 0
    }

    @After
    fun tearDown() {
        scenario?.close()
        instrumentation.removeMonitor(monitor)
    }

    private fun findWebView(view: View): WebView? = when {
        view is WebView -> view
        view is ViewGroup -> (0 until view.childCount).firstNotNullOfOrNull { findWebView(view.getChildAt(it)) }
        else -> null
    }

    /** Drives the activity's own `WebViewClient` and reports the launches it caused. */
    private fun navigateTo(url: String) {
        var called: Boolean? = null
        scenario?.onActivity { activity: MainActivity ->
            val webView = findWebView(activity.window.decorView)
                ?: error("找不到 WebView：布局变了？")
            called = webView.webViewClient.shouldOverrideUrlLoading(webView, Request(Uri.parse(url)))
        }
        assertTrue("shouldOverrideUrlLoading 必须被调用到", called != null)
    }

    @Test
    fun anOffOriginWebPageLink_isHandedToTheSystem() {
        // The positive control. Without it, every refusal below would also pass
        // on a harness that simply never observed a launch.
        navigateTo("https://example.com/some-page")

        assertEquals("http(s) 应当真的交给系统，否则下面的拒绝无从判断", 1, launches)
    }

    @Test
    fun anIntentUri_isRefusedRatherThanLaunched() {
        navigateTo("intent://scan/#Intent;scheme=zxing;component=com.example/.Scan;end")

        assertEquals("页面不得让系统启动任意组件", 0, launches)
    }

    @Test
    fun aFileUri_isRefusedRatherThanHandedToTheSystem() {
        navigateTo("file:///data/data/dev.opencodemanager.app/shared_prefs/creds.xml")

        assertEquals("页面不得拿到本应用的私有文件", 0, launches)
    }

    @Test
    fun aCustomScheme_withARegisteredHandler_isRefused() {
        // The rule is http and https only, because anything else is whatever
        // the machine happens to have registered.
        navigateTo("smb://files.example/share")

        assertEquals("已注册的协议处理器同样不得由页面触发", 0, launches)
    }
}
