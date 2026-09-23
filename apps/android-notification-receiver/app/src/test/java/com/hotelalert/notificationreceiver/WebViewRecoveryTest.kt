package com.hotelalert.notificationreceiver

import com.hotelalert.notificationreceiver.ui.WebViewRecoveryMode
import com.hotelalert.notificationreceiver.ui.WebViewRecoveryState
import com.hotelalert.notificationreceiver.ui.reopenWebView
import com.hotelalert.notificationreceiver.ui.webViewStateAfterLoadError
import org.junit.Assert.assertEquals
import org.junit.Test

class WebViewRecoveryTest {
    @Test
    fun `main-frame load failures expose recovery and preserve the failed origin`() {
        val initialState = WebViewRecoveryState()
        val failedOrigin = "http://192.168.1.20:3000"

        assertEquals(
            WebViewRecoveryState(
                mode = WebViewRecoveryMode.RECOVERY,
                failedServerOrigin = failedOrigin
            ),
            webViewStateAfterLoadError(
                initialState,
                isForMainFrame = true,
                serverOrigin = failedOrigin
            )
        )
    }

    @Test
    fun `subresource failures do not replace the failed origin`() {
        val recoveryState = WebViewRecoveryState(
            mode = WebViewRecoveryMode.RECOVERY,
            reloadKey = 4,
            failedServerOrigin = "http://192.168.1.20:3000"
        )

        assertEquals(
            recoveryState,
            webViewStateAfterLoadError(
                recoveryState,
                isForMainFrame = false,
                serverOrigin = "http://192.168.1.21:3000"
            )
        )
    }

    @Test
    fun `retrying recovery clears the failed origin and reopens the webview with a fresh instance key`() {
        val recoveryState = WebViewRecoveryState(
            mode = WebViewRecoveryMode.RECOVERY,
            reloadKey = 4,
            failedServerOrigin = "http://192.168.1.20:3000"
        )

        assertEquals(
            WebViewRecoveryState(mode = WebViewRecoveryMode.WEB_VIEW, reloadKey = 5),
            reopenWebView(recoveryState)
        )
    }

    @Test
    fun `a later main-frame failure replaces the origin after recovery reopens`() {
        val firstFailure = webViewStateAfterLoadError(
            WebViewRecoveryState(),
            isForMainFrame = true,
            serverOrigin = "http://192.168.1.20:3000"
        )

        val reopened = reopenWebView(firstFailure)

        assertEquals(
            "http://192.168.1.21:3000",
            webViewStateAfterLoadError(
                reopened,
                isForMainFrame = true,
                serverOrigin = "http://192.168.1.21:3000"
            ).failedServerOrigin
        )
    }
}
