package com.hotelalert.notificationreceiver

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import com.hotelalert.notificationreceiver.protocol.ReceiverConfiguration
import com.hotelalert.notificationreceiver.receiver.HotelNotificationReceiverService
import com.hotelalert.notificationreceiver.ui.HotelWebView
import com.hotelalert.notificationreceiver.ui.HotelAlertTheme
import com.hotelalert.notificationreceiver.ui.ReceiverScreen
import com.hotelalert.notificationreceiver.ui.ServerOriginRecoveryScreen
import com.hotelalert.notificationreceiver.ui.ServerOriginSetupScreen
import com.hotelalert.notificationreceiver.ui.WebViewRecoveryMode
import com.hotelalert.notificationreceiver.ui.WebViewRecoveryState
import com.hotelalert.notificationreceiver.ui.reopenWebView
import com.hotelalert.notificationreceiver.ui.webViewStateAfterLoadError
import java.util.UUID

class MainActivity : ComponentActivity() {
    private val component: AndroidReceiverComponent
        get() = (application as HotelAlertApplication).component
    private var diagnosticsMode by mutableStateOf(false)
    private var openedEventId by mutableStateOf<String?>(null)
    private var notificationPermissionGranted by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applyIntent(intent)
        val storedOrigin = component.serverOriginStore.read()
        setContent {
            HotelAlertTheme {
                var serverOrigin by rememberSaveable { mutableStateOf(storedOrigin) }
                var webViewRecoveryState by remember { mutableStateOf(WebViewRecoveryState()) }
                val configuredOrigin = serverOrigin
                if (configuredOrigin == null) {
                    ServerOriginSetupScreen(
                        initialServerOrigin = webViewRecoveryState.failedServerOrigin ?: storedOrigin,
                        onSave = { normalizedOrigin ->
                            runCatching {
                                component.serverOriginStore.write(normalizedOrigin)
                                serverOrigin = component.serverOriginStore.read() ?: normalizedOrigin
                                webViewRecoveryState = reopenWebView(webViewRecoveryState)
                            }.isSuccess
                        }
                    )
                } else if (diagnosticsMode) {
                    val receiverState by component.statusStore.state.collectAsState()
                    ReceiverScreen(
                        state = receiverState,
                        initialConfiguration = component.configurationStore.read(),
                        notificationPermissionGranted = notificationPermissionGranted,
                        openedEventId = openedEventId,
                        onRequestNotificationPermission = { requestNotificationPermission() },
                        onSaveAndStart = ::saveAndStartReceiver,
                        onStop = { HotelNotificationReceiverService.stop(this@MainActivity) }
                    )
                } else if (webViewRecoveryState.mode == WebViewRecoveryMode.RECOVERY) {
                    ServerOriginRecoveryScreen(
                        serverOrigin = configuredOrigin,
                        onRetry = { webViewRecoveryState = reopenWebView(webViewRecoveryState) },
                        onChangeServer = {
                            serverOrigin = null
                        }
                    )
                } else {
                    HotelWebView(
                        serverOrigin = configuredOrigin,
                        bridge = component.webBridge,
                        reloadKey = webViewRecoveryState.reloadKey,
                        onMainFrameLoadFailure = {
                            webViewRecoveryState = webViewStateAfterLoadError(
                                currentState = webViewRecoveryState,
                                isForMainFrame = true,
                                serverOrigin = configuredOrigin
                            )
                        }
                    )
                }
            }
        }
        resumeReceiverIfConfigured()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        applyIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        setAppInForeground(true)
        notificationPermissionGranted = hasNotificationPermission()
    }

    override fun onPause() {
        setAppInForeground(false)
        super.onPause()
    }

    private fun applyIntent(intent: Intent) {
        diagnosticsMode = shouldShowReceiverDiagnostics(intent)
        openedEventId = intent.getStringExtra(EXTRA_EVENT_ID)
        notificationPermissionGranted = hasNotificationPermission()
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_PERMISSION_REQUEST_CODE)
        }
    }

    private fun hasNotificationPermission(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
        || ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun saveAndStartReceiver(serverOrigin: String, deviceId: String, token: String) {
        lifecycleScope.launch {
            runCatching {
                val normalizedOrigin = com.hotelalert.notificationreceiver.web.normalizeAndValidateServerOrigin(serverOrigin)
                val previousConfiguration = component.configurationStore.read()
                component.serverOriginStore.write(normalizedOrigin)
                component.tokenStore.write(token)
                component.configurationStore.write(
                    ReceiverConfiguration(
                        serverOrigin = normalizedOrigin,
                        deviceId = deviceId,
                        clientInstanceId = previousConfiguration?.clientInstanceId ?: UUID.randomUUID().toString(),
                        clientVersion = BuildConfig.VERSION_NAME
                    )
                )
                component.configurationStore.writeReceiverRunIntent(true)
                HotelNotificationReceiverService.start(this@MainActivity)
            }.onFailure {
                component.statusStore.update(com.hotelalert.notificationreceiver.protocol.ReceiverState.ERROR)
            }
        }
    }

    private fun resumeReceiverIfConfigured() {
        lifecycleScope.launch {
            val shouldStart = try {
                component.shouldStartReceiver()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                component.statusStore.update(com.hotelalert.notificationreceiver.protocol.ReceiverState.ERROR)
                false
            }
            if (shouldStart) HotelNotificationReceiverService.start(this@MainActivity)
        }
    }

    companion object {
        const val EXTRA_EVENT_ID = "eventId"
        const val EXTRA_REQUEST_ID = "requestId"
        const val EXTRA_AREA_ID = "areaId"
        const val EXTRA_SHOW_DIAGNOSTICS = "showDiagnostics"
        private const val NOTIFICATION_PERMISSION_REQUEST_CODE = 1001

        @Volatile
        private var appInForeground = false

        internal fun isAppInForeground(): Boolean = appInForeground

        private fun setAppInForeground(value: Boolean) {
            appInForeground = value
        }
    }
}

internal fun shouldShowReceiverDiagnostics(intent: Intent): Boolean =
    shouldShowReceiverDiagnostics(
        showDiagnostics = intent.getBooleanExtra(MainActivity.EXTRA_SHOW_DIAGNOSTICS, false)
    )

internal fun shouldShowReceiverDiagnostics(
    showDiagnostics: Boolean = false,
    hasEventId: Boolean = false,
    hasRequestId: Boolean = false,
    hasAreaId: Boolean = false
): Boolean = showDiagnostics
