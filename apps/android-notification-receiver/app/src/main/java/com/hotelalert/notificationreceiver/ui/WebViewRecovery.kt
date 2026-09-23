package com.hotelalert.notificationreceiver.ui

internal enum class WebViewRecoveryMode {
    WEB_VIEW,
    RECOVERY
}

internal data class WebViewRecoveryState(
    val mode: WebViewRecoveryMode = WebViewRecoveryMode.WEB_VIEW,
    val reloadKey: Int = 0,
    val failedServerOrigin: String? = null
)

internal fun webViewStateAfterLoadError(
    currentState: WebViewRecoveryState,
    isForMainFrame: Boolean,
    serverOrigin: String? = currentState.failedServerOrigin
): WebViewRecoveryState = if (isForMainFrame) {
    currentState.copy(
        mode = WebViewRecoveryMode.RECOVERY,
        failedServerOrigin = serverOrigin
    )
} else {
    currentState
}

internal fun reopenWebView(currentState: WebViewRecoveryState): WebViewRecoveryState =
    currentState.copy(
        mode = WebViewRecoveryMode.WEB_VIEW,
        reloadKey = currentState.reloadKey + 1,
        failedServerOrigin = null
    )
