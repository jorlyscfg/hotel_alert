package com.hotelalert.notificationreceiver.ui

import android.annotation.SuppressLint
import android.content.Context
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import com.hotelalert.notificationreceiver.RoomScreensaverButtonAction
import com.hotelalert.notificationreceiver.web.NativeWebViewBridgeContract
import com.hotelalert.notificationreceiver.web.HotelAlertWebBridge
import com.hotelalert.notificationreceiver.web.WebViewNavigationPolicy
import java.io.ByteArrayInputStream
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.UUID

@Composable
fun HotelWebView(
    serverOrigin: String,
    bridge: HotelAlertWebBridge = HotelAlertWebBridge(),
    reloadKey: Int = 0,
    startRequestId: String? = null,
    onMainFrameLoadFailure: () -> Unit = {},
    onScreenTap: () -> Unit = {},
    onScreenWakeFromBlackout: () -> Boolean = { false },
    modifier: Modifier = Modifier.fillMaxSize()
) {
    val context = LocalContext.current
    key(serverOrigin, reloadKey, startRequestId) {
        AndroidView(
            factory = {
                createRestrictedWebView(context, serverOrigin, bridge, onMainFrameLoadFailure, startRequestId).also { webView ->
                    bridge.bindRoomScreensaverButtonListener(webView) { action ->
                        webView.post {
                            if (webView.isAttachedToWindow) {
                                webView.evaluateJavascript(roomScreensaverButtonEventScript(action), null)
                            }
                        }
                    }
                }
            },
            modifier = modifier,
            update = { webView -> installTapObserver(webView, context, onScreenTap, onScreenWakeFromBlackout) },
            onRelease = { webView ->
                webView.stopLoading()
                bridge.unbindRoomScreensaverButtonListener(webView)
                bridge.clearRoomScreensaverState()
                webView.removeJavascriptInterface(NativeWebViewBridgeContract.name)
                webView.destroy()
            }
        )
    }
}

private fun installTapObserver(
    webView: WebView,
    context: Context,
    onScreenTap: () -> Unit,
    onScreenWakeFromBlackout: () -> Boolean
) {
    val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
    var downX = 0f
    var downY = 0f
    var downAtMillis = 0L
    var isTap = false
    var consumeWakeGesture = false
    webView.setOnTouchListener { _, event ->
        if (consumeWakeGesture) {
            if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
                consumeWakeGesture = false
            }
            return@setOnTouchListener true
        }
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                if (onScreenWakeFromBlackout()) {
                    consumeWakeGesture = true
                    isTap = false
                    return@setOnTouchListener true
                }
                downX = event.x
                downY = event.y
                downAtMillis = event.eventTime
                isTap = true
            }
            MotionEvent.ACTION_MOVE -> {
                val dx = event.x - downX
                val dy = event.y - downY
                if (dx * dx + dy * dy > touchSlop * touchSlop) isTap = false
            }
            MotionEvent.ACTION_POINTER_DOWN -> isTap = false
            MotionEvent.ACTION_UP -> {
                if (isTap && event.eventTime - downAtMillis <= TAP_MAX_DURATION_MILLIS) onScreenTap()
                isTap = false
            }
            MotionEvent.ACTION_CANCEL -> isTap = false
        }
        false
    }
}

internal fun roomScreensaverButtonEventScript(action: RoomScreensaverButtonAction): String =
    "window.dispatchEvent(new CustomEvent('hotel-alert-room-screensaver-button', {detail: '${action.name}', bubbles: false}));"

private const val TAP_MAX_DURATION_MILLIS = 500L

@SuppressLint("SetJavaScriptEnabled")
internal fun createRestrictedWebView(
    context: Context,
    serverOrigin: String,
    bridge: HotelAlertWebBridge = HotelAlertWebBridge(),
    onMainFrameLoadFailure: () -> Unit = {},
    startRequestId: String? = null
): WebView {
    val policy = WebViewNavigationPolicy(serverOrigin)
    return WebView(context).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.allowFileAccessFromFileURLs = false
        settings.allowUniversalAccessFromFileURLs = false
        settings.javaScriptCanOpenWindowsAutomatically = false
        settings.setSupportMultipleWindows(false)
        settings.mediaPlaybackRequiresUserGesture = true
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        addJavascriptInterface(bridge, NativeWebViewBridgeContract.name)
        setDownloadListener { _, _, _, _, _ -> }
        webViewClient = restrictedWebViewClient(policy, onMainFrameLoadFailure)
        loadUrl(
            webViewEntryUrl(serverOrigin, UUID.randomUUID().toString(), startRequestId),
            mapOf("Cache-Control" to "no-cache", "Pragma" to "no-cache")
        )
    }
}

internal fun webViewEntryUrl(serverOrigin: String, cacheBust: String, startRequestId: String? = null): String {
    val startRequestQuery = startRequestId
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?.let { "&startRequestId=${URLEncoder.encode(it, StandardCharsets.UTF_8.name())}" }
        .orEmpty()
    return "${serverOrigin.trim().trimEnd('/')}/?__hotel_alert_webview_reload=${URLEncoder.encode(cacheBust, StandardCharsets.UTF_8.name())}$startRequestQuery"
}

private fun restrictedWebViewClient(
    policy: WebViewNavigationPolicy,
    onMainFrameLoadFailure: () -> Unit
): WebViewClient = object : WebViewClient() {
    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (request.isForMainFrame) onMainFrameLoadFailure()
    }

    override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
        if (request.isForMainFrame) onMainFrameLoadFailure()
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        return !policy.isAllowedNavigation(request.url.toString())
    }

    @Suppress("DEPRECATION")
    override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
        return !policy.isAllowedNavigation(url)
    }

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        if (policy.isAllowedNavigation(request.url.toString())) return super.shouldInterceptRequest(view, request)
        return blockedResourceResponse()
    }

    @Suppress("DEPRECATION")
    override fun shouldInterceptRequest(view: WebView, url: String): WebResourceResponse? {
        if (policy.isAllowedNavigation(url)) return super.shouldInterceptRequest(view, url)
        return blockedResourceResponse()
    }
}

private fun blockedResourceResponse(): WebResourceResponse = WebResourceResponse(
    "text/plain",
    "UTF-8",
    ByteArrayInputStream(ByteArray(0))
)
