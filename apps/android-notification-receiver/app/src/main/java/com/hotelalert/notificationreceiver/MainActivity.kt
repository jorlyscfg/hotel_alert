package com.hotelalert.notificationreceiver

import android.Manifest
import android.app.role.RoleManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import com.hotelalert.notificationreceiver.protocol.ReceiverConfiguration
import com.hotelalert.notificationreceiver.receiver.HotelNotificationReceiverService
import com.hotelalert.notificationreceiver.receiver.RoomPresenceService
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
    private var roomSessionConfigured = false
    private var roomSessionReceiverRegistered = false

    private val homeRoleRequestLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { }

    private val roomSessionChangedReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            refreshRoomKioskState(requestHomeRoleIfNeeded = true)
        }
    }

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
        refreshRoomKioskState(requestHomeRoleIfNeeded = false)
    }

    override fun onStart() {
        super.onStart()
        ContextCompat.registerReceiver(
            this,
            roomSessionChangedReceiver,
            IntentFilter(RoomPresenceService.ACTION_ROOM_SESSION_CHANGED),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
        roomSessionReceiverRegistered = true
    }

    override fun onStop() {
        if (roomSessionReceiverRegistered) {
            unregisterReceiver(roomSessionChangedReceiver)
            roomSessionReceiverRegistered = false
        }
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        setAppInForeground(true)
        notificationPermissionGranted = hasNotificationPermission()
        refreshRoomKioskState(requestHomeRoleIfNeeded = true)
    }

    override fun onPause() {
        setAppInForeground(false)
        super.onPause()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) updateRoomWindowMode()
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

    private fun refreshRoomKioskState(requestHomeRoleIfNeeded: Boolean) {
        lifecycleScope.launch {
            roomSessionConfigured = withContext(Dispatchers.IO) {
                runCatching { component.hasConfiguredRoomPresenceSession() }.getOrDefault(false)
            }
            updateRoomWindowMode()

            if (roomSessionConfigured) {
                runCatching { RoomPresenceService.start(this@MainActivity) }
                    .onFailure { Log.w(TAG, "ROOM presence could not be started from the foreground Activity.", it) }
                if (requestHomeRoleIfNeeded) requestHomeRoleIfNeeded()
            }
        }
    }

    private fun requestHomeRoleIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
        val roleManager = getSystemService(RoleManager::class.java) ?: return
        val preferences = getSharedPreferences(ROOM_KIOSK_PREFERENCES, MODE_PRIVATE)
        val requestAlreadyAttempted = preferences.getBoolean(HOME_ROLE_REQUEST_ATTEMPTED_KEY, false)
        if (!shouldRequestHomeRole(
                apiLevel = Build.VERSION.SDK_INT,
                hasRoomSession = roomSessionConfigured,
                roleAvailable = roleManager.isRoleAvailable(RoleManager.ROLE_HOME),
                roleHeld = roleManager.isRoleHeld(RoleManager.ROLE_HOME),
                requestAlreadyAttempted = requestAlreadyAttempted
            )
        ) return

        try {
            homeRoleRequestLauncher.launch(roleManager.createRequestRoleIntent(RoleManager.ROLE_HOME))
            preferences.edit().putBoolean(HOME_ROLE_REQUEST_ATTEMPTED_KEY, true).apply()
        } catch (error: Exception) {
            Log.w(TAG, "The HOME role request could not be opened; use Android Settings to select Hotel Alert as Home.", error)
        }
    }

    private fun updateRoomWindowMode() {
        val immersive = shouldUseRoomImmersiveMode(
            hasRoomSession = roomSessionConfigured,
            hasServerOrigin = runCatching { component.serverOriginStore.read() != null }.getOrDefault(false),
            showDiagnostics = diagnosticsMode
        )
        WindowCompat.setDecorFitsSystemWindows(window, !immersive)
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        if (immersive) controller.hide(WindowInsetsCompat.Type.systemBars())
        else controller.show(WindowInsetsCompat.Type.systemBars())
    }

    companion object {
        const val EXTRA_EVENT_ID = "eventId"
        const val EXTRA_REQUEST_ID = "requestId"
        const val EXTRA_AREA_ID = "areaId"
        const val EXTRA_SHOW_DIAGNOSTICS = "showDiagnostics"
        private const val NOTIFICATION_PERMISSION_REQUEST_CODE = 1001
        private const val ROOM_KIOSK_PREFERENCES = "hotel_alert_room_kiosk"
        private const val HOME_ROLE_REQUEST_ATTEMPTED_KEY = "home_role_request_attempted"
        private const val TAG = "HotelAlertMainActivity"

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
