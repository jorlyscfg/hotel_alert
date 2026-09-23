package com.hotelalert.notificationreceiver.ui

import android.annotation.SuppressLint
import android.content.Context
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
    onMainFrameLoadFailure: () -> Unit = {},
    modifier: Modifier = Modifier.fillMaxSize()
) {
    val context = LocalContext.current
    key(serverOrigin, reloadKey) {
        AndroidView(
            factory = {
                createRestrictedWebView(context, serverOrigin, bridge, onMainFrameLoadFailure)
            },
            modifier = modifier,
            onRelease = { webView ->
                webView.stopLoading()
                webView.removeJavascriptInterface(NativeWebViewBridgeContract.name)
                webView.destroy()
            }
        )
    }
}

@SuppressLint("SetJavaScriptEnabled")
internal fun createRestrictedWebView(
    context: Context,
    serverOrigin: String,
    bridge: HotelAlertWebBridge = HotelAlertWebBridge(),
    onMainFrameLoadFailure: () -> Unit = {}
): WebView {
    val policy = WebViewNavigationPolicy(serverOrigin)
    return WebView(context).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        // The console is served from a development LAN origin in kiosk deployments. Do not
        // let WebView reuse an old HTML/module graph after the server has been updated.
        settings.cacheMode = WebSettings.LOAD_NO_CACHE
        clearCache(true)
        clearHistory()
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
            webViewEntryUrl(serverOrigin, UUID.randomUUID().toString()),
            mapOf("Cache-Control" to "no-cache", "Pragma" to "no-cache")
        )
    }
}

internal fun webViewEntryUrl(serverOrigin: String, cacheBust: String): String =
    "${serverOrigin.trim().trimEnd('/')}/?__hotel_alert_webview_reload=${URLEncoder.encode(cacheBust, StandardCharsets.UTF_8.name())}"

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
