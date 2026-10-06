package com.hotelalert.notificationreceiver

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput

import android.Manifest
import android.annotation.SuppressLint
import android.app.ActivityManager
import android.app.role.RoleManager
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.KeyEvent
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
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
import com.hotelalert.notificationreceiver.protocol.notificationStartRequestId
import com.hotelalert.notificationreceiver.admin.AndroidRoomHomePolicy
import com.hotelalert.notificationreceiver.admin.AndroidRoomLockTaskDevicePolicy
import com.hotelalert.notificationreceiver.admin.RoomLockTaskPreparation
import com.hotelalert.notificationreceiver.receiver.HotelNotificationReceiverService
import com.hotelalert.notificationreceiver.receiver.RoomPresenceService
import com.hotelalert.notificationreceiver.storage.AndroidRoomMaintenancePinStore
import com.hotelalert.notificationreceiver.storage.RoomMaintenancePinVerification
import com.hotelalert.notificationreceiver.RoomHomeStatus
import com.hotelalert.notificationreceiver.RoomLockTaskStatus
import com.hotelalert.notificationreceiver.HomeSelectionAction
import com.hotelalert.notificationreceiver.chooseHomeSelectionAction
import com.hotelalert.notificationreceiver.mayLaunchExternalActivityAfterRoomLockTaskExit
import com.hotelalert.notificationreceiver.roomLockTaskStatus
import com.hotelalert.notificationreceiver.roomLockTaskMaintenanceExitAction
import com.hotelalert.notificationreceiver.shouldRestorePinAuthorizedMaintenanceSettings
import com.hotelalert.notificationreceiver.shouldPersistPinAuthorizedMaintenanceSettingsMarker
import com.hotelalert.notificationreceiver.shouldRestoreStrictRoomLockTask
import com.hotelalert.notificationreceiver.RoomLockTaskMaintenanceExitAction
import com.hotelalert.notificationreceiver.ui.HotelWebView
import com.hotelalert.notificationreceiver.ui.HotelAlertTheme
import com.hotelalert.notificationreceiver.ui.RoomMaintenancePinDialog
import com.hotelalert.notificationreceiver.ui.RoomMaintenanceSettingsScreen
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
    private var startRequestId by mutableStateOf<String?>(null)
    private var notificationPermissionGranted by mutableStateOf(false)
    private var roomSessionConfigured = false
    private var roomSessionReceiverRegistered = false
    private var maintenanceRoute by mutableStateOf(RoomMaintenanceRoute.CLOSED)
    private var maintenanceSettingsRestorePending = false
    private var maintenancePinError by mutableStateOf<String?>(null)
    private var maintenancePinChangeMessage by mutableStateOf<String?>(null)
    private var isCheckingMaintenancePin by mutableStateOf(false)
    private var homeStatus by mutableStateOf(RoomHomeStatus.UNKNOWN)
    private var isDeviceOwner by mutableStateOf(false)
    private var homeRoleAvailable by mutableStateOf(false)
    private var strictModeDraft by mutableStateOf(false)
    private var roomScreenBrightnessPreference = RoomScreenBrightnessPreference()
    private var roomScreenBrightnessDraft by mutableStateOf(RoomScreenBrightnessPreference())
    private var strictModeAvailable by mutableStateOf(false)
    private var strictModeAvailabilityMessage by mutableStateOf<String?>(null)
    private var strictModeStatus by mutableStateOf(RoomLockTaskStatus.INACTIVE)
    private var kioskControlMessage by mutableStateOf<String?>(null)
    private var overlayPermissionGranted by mutableStateOf(false)
    private var strictModePreference = false
    private var activityResumed = false
    private var roomWindowFocused = false
    private var roomScreensaverRequested = false
    private val roomScreensaverDisplayBlackout = mutableStateOf(false)
    private var roomScreensaverBrightnessWasEligible = false
    private var lastRoomScreensaverBrightnessDiagnostic: String? = null
    private var roomScreensaverBrightnessPercent = roomScreensaverBrightnessStartPercent(DEFAULT_ROOM_SCREEN_BRIGHTNESS_PERCENT)
    private var roomScreensaverBrightnessStepScheduled = false
    private val roomScreensaverBrightnessHandler = Handler(Looper.getMainLooper())
    private val roomScreensaverBrightnessStep = Runnable {
        roomScreensaverBrightnessStepScheduled = false
        if (isRoomScreensaverBrightnessEligible()) {
            roomScreensaverBrightnessPercent = roomScreensaverBrightnessPercentAfterStep(roomScreensaverBrightnessPercent)
        }
        applyRoomWindowBrightness()
    }
    private var lockTaskStartedByThisActivity = false
    private val maintenanceTapGate = RoomMaintenanceTapGate()
    private val maintenancePinStore by lazy { AndroidRoomMaintenancePinStore(applicationContext) }
    private val roomHomePolicy by lazy { AndroidRoomHomePolicy(applicationContext) }
    private val roomLockTaskPolicy by lazy { AndroidRoomLockTaskDevicePolicy(applicationContext) }

    private val homeRoleRequestLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) {
        refreshHomeSelectionStatus()
    }

    private val roomSessionChangedReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            refreshRoomKioskState(requestHomeRoleIfNeeded = true)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applyIntent(intent)
        maintenanceSettingsRestorePending = savedInstanceState
            ?.getBoolean(STATE_MAINTENANCE_SETTINGS_OPEN_KEY, false) == true && !diagnosticsMode
        updateRoomWakeRecoverySuppression()
        val maintenancePreferences = getSharedPreferences(ROOM_KIOSK_PREFERENCES, MODE_PRIVATE)
        strictModePreference = maintenancePreferences.getBoolean(STRICT_ROOM_LOCK_TASK_KEY, false)
        strictModeDraft = strictModePreference
        roomScreenBrightnessPreference = normalizedRoomScreenBrightnessPreference(
            manualEnabled = maintenancePreferences.getBoolean(ROOM_SCREEN_BRIGHTNESS_MANUAL_KEY, false),
            levelPercent = maintenancePreferences.getInt(
                ROOM_SCREEN_BRIGHTNESS_LEVEL_PERCENT_KEY,
                DEFAULT_ROOM_SCREEN_BRIGHTNESS_PERCENT
            )
        )
        roomScreenBrightnessDraft = roomScreenBrightnessPreference
        component.webBridge.bindRoomScreensaverStateListener(this, ::handleRoomScreensaverStateChanged)
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
                                applyRoomWindowBrightness()
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
                    Box(Modifier.fillMaxSize()) {
                        HotelWebView(
                            serverOrigin = configuredOrigin,
                            bridge = component.webBridge,
                            reloadKey = webViewRecoveryState.reloadKey,
                            startRequestId = startRequestId,
                            onMainFrameLoadFailure = {
                                webViewRecoveryState = webViewStateAfterLoadError(
                                    currentState = webViewRecoveryState,
                                    isForMainFrame = true,
                                    serverOrigin = configuredOrigin
                                )
                            },
                            onScreenTap = ::onRoomScreenTap,
                            onScreenWakeFromBlackout = ::wakeRoomScreensaverDisplay
                        )
                        if (roomScreensaverDisplayBlackout.value) {
                            Box(
                                Modifier
                                    .fillMaxSize()
                                    .background(Color.Black)
                                    .pointerInput(Unit) {
                                        detectTapGestures { wakeRoomScreensaverDisplay() }
                                    }
                            )
                        }
                        when (maintenanceRoute) {
                            RoomMaintenanceRoute.CLOSED -> Unit
                            RoomMaintenanceRoute.PIN -> RoomMaintenancePinDialog(
                                errorMessage = maintenancePinError,
                                isChecking = isCheckingMaintenancePin,
                                onSubmit = ::verifyMaintenancePin,
                                onDismiss = ::closeMaintenance
                            )
                            RoomMaintenanceRoute.SETTINGS -> {
                                BackHandler(onBack = ::saveMaintenanceAndReturn)
                                RoomMaintenanceSettingsScreen(
                                    pinChangeMessage = maintenancePinChangeMessage,
                                    homeStatus = homeStatus,
                                    isDeviceOwner = isDeviceOwner,
                                    strictModeOptedIn = strictModePreference,
                                    strictModeRequested = strictModeDraft,
                                    strictModeAvailable = strictModeAvailable,
                                    strictModeStatus = strictModeStatus,
                                    strictModeAvailabilityMessage = strictModeAvailabilityMessage,
                                    kioskControlMessage = kioskControlMessage,
                                    overlayPermissionRequired = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q,
                                    overlayPermissionGranted = overlayPermissionGranted,
                                    roomBrightnessManual = roomScreenBrightnessDraft.manualEnabled,
                                    roomBrightnessPercent = roomScreenBrightnessDraft.levelPercent,
                                    onChooseHome = ::chooseHotelAlertHome,
                                    onOpenHomeSelectionSettings = ::openHomeSelectionSettings,
                                    onClearManagedHome = ::clearManagedHome,
                                    onOpenAndroidSettings = ::openAndroidSettings,
                                    onOpenWirelessDebuggingSettings = ::openWirelessDebuggingSettings,
                                    onManageOverlayPermission = ::openOverlayPermissionSettings,
                                    onStrictModeChange = { strictModeDraft = it },
                                    onRoomBrightnessManualChange = {
                                        roomScreenBrightnessDraft = roomScreenBrightnessDraft.copy(manualEnabled = it)
                                        applyRoomWindowBrightness()
                                    },
                                    onRoomBrightnessPercentChange = {
                                        roomScreenBrightnessDraft = roomScreenBrightnessDraft.copy(
                                            levelPercent = normalizeRoomScreenBrightnessPercent(it)
                                        )
                                        applyRoomWindowBrightness()
                                    },
                                    onChangePin = ::changeMaintenancePin,
                                    onSaveAndReturn = ::saveMaintenanceAndReturn
                                )
                            }
                        }
                    }
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

    // This public Activity callback must run before the focused WebView can consume ROOM keys.
    @SuppressLint("RestrictedApi")
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (shouldInterceptRoomScreensaverButtonBeforeWebView(
                keyCode = event.keyCode,
                isScreensaverEligible = isRoomScreensaverBrightnessEligible()
            )
        ) {
            when (roomScreensaverButtonAction(
                keyCode = event.keyCode,
                eventAction = event.action,
                repeatCount = event.repeatCount,
                isScreensaverActive = true
            )) {
                RoomScreensaverButtonAction.TOGGLE_DO_NOT_DISTURB ->
                    component.webBridge.dispatchRoomScreensaverButton(RoomScreensaverButtonAction.TOGGLE_DO_NOT_DISTURB)
                RoomScreensaverButtonAction.TOGGLE_DISPLAY_BLACKOUT -> {
                    roomScreensaverDisplayBlackout.value = !roomScreensaverDisplayBlackout.value
                    applyRoomWindowBrightness()
                }
                null -> Unit
            }
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putBoolean(
            STATE_MAINTENANCE_SETTINGS_OPEN_KEY,
            shouldPersistPinAuthorizedMaintenanceSettingsMarker(
                settingsAreOpen = maintenanceRoute == RoomMaintenanceRoute.SETTINGS,
                restoreIsPending = maintenanceSettingsRestorePending,
                hasRoomSession = roomSessionConfigured,
                diagnosticsMode = diagnosticsMode
            )
        )
    }

    override fun onStart() {
        super.onStart()
        setActivityVisible(true)
        ContextCompat.registerReceiver(
            this,
            roomSessionChangedReceiver,
            IntentFilter(RoomPresenceService.ACTION_ROOM_SESSION_CHANGED),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
        roomSessionReceiverRegistered = true
    }

    override fun onStop() {
        setActivityVisible(false)
        if (roomSessionReceiverRegistered) {
            unregisterReceiver(roomSessionChangedReceiver)
            roomSessionReceiverRegistered = false
        }
        super.onStop()
    }

    override fun onDestroy() {
        roomScreensaverRequested = false
        applyRoomWindowBrightness()
        cancelRoomScreensaverBrightnessStep()
        component.webBridge.unbindRoomScreensaverStateListener(this)
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        activityResumed = true
        roomWindowFocused = window.decorView.hasWindowFocus()
        applyRoomKeepScreenOn()
        applyRoomWindowBrightness()
        setAppInForeground(true)
        notificationPermissionGranted = hasNotificationPermission()
        refreshRoomKioskState(requestHomeRoleIfNeeded = true)
    }

    override fun onPause() {
        activityResumed = false
        roomWindowFocused = false
        applyRoomKeepScreenOn()
        applyRoomWindowBrightness()
        setAppInForeground(false)
        super.onPause()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        roomWindowFocused = hasFocus
        if (hasFocus) updateRoomWindowMode()
        else {
            applyRoomKeepScreenOn()
            applyRoomWindowBrightness()
        }
    }

    private fun handleRoomScreensaverStateChanged(active: Boolean) {
        runOnUiThread {
            if (isFinishing || isDestroyed) return@runOnUiThread
            roomScreensaverRequested = active
            applyRoomWindowBrightness()
        }
    }

    private fun applyIntent(intent: Intent) {
        diagnosticsMode = shouldShowReceiverDiagnostics(intent)
        openedEventId = intent.getStringExtra(EXTRA_EVENT_ID)
        startRequestId = notificationStartRequestId(intent.getStringExtra(EXTRA_START_REQUEST_ID))
        notificationPermissionGranted = hasNotificationPermission()
        if (diagnosticsMode) {
            roomScreensaverRequested = false
            maintenanceSettingsRestorePending = false
            maintenanceRoute = RoomMaintenanceRoute.CLOSED
            strictModeDraft = strictModePreference
            roomScreenBrightnessDraft = roomScreenBrightnessPreference
        }
        updateRoomWakeRecoverySuppression()
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
                applyRoomWindowBrightness()
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
            if (maintenanceSettingsRestorePending) {
                val shouldRestoreSettings = shouldRestorePinAuthorizedMaintenanceSettings(
                    settingsWereOpenWhenActivityWasSaved = true,
                    hasRoomSession = roomSessionConfigured,
                    diagnosticsMode = diagnosticsMode
                )
                maintenanceSettingsRestorePending = false
                if (shouldRestoreSettings) {
                    maintenanceRoute = RoomMaintenanceRoute.SETTINGS
                    maintenancePinError = null
                    maintenancePinChangeMessage = null
                    kioskControlMessage = null
                    strictModeDraft = strictModePreference
                    roomScreenBrightnessDraft = roomScreenBrightnessPreference
                } else {
                    maintenanceRoute = RoomMaintenanceRoute.CLOSED
                    maintenancePinError = null
                    maintenancePinChangeMessage = null
                    roomScreenBrightnessDraft = roomScreenBrightnessPreference
                }
            }
            if ((!roomSessionConfigured || diagnosticsMode) && maintenanceRoute != RoomMaintenanceRoute.CLOSED) {
                maintenanceRoute = RoomMaintenanceRoute.CLOSED
                maintenancePinError = null
                maintenancePinChangeMessage = null
                roomScreenBrightnessDraft = roomScreenBrightnessPreference
            }
            if (!roomSessionConfigured || diagnosticsMode) maintenanceSettingsRestorePending = false
            if (!roomSessionConfigured || diagnosticsMode) {
                val lockStatus = readRoomLockTaskStatus()
                if (lockTaskStartedByThisActivity || lockStatus != RoomLockTaskStatus.INACTIVE) {
                    ensureRoomLockTaskExitedSafely()
                }
            }
            updateRoomWindowMode()

            if (roomSessionConfigured) {
                runCatching { RoomPresenceService.start(this@MainActivity) }
                    .onFailure { Log.w(TAG, "ROOM presence could not be started from the foreground Activity.", it) }
                if (maintenanceRoute == RoomMaintenanceRoute.SETTINGS) {
                    refreshMaintenanceDeviceState()
                } else if (!diagnosticsMode) {
                    val rolePromptOpened = requestHomeRoleIfNeeded && requestHomeRoleIfNeeded()
                    if (!rolePromptOpened) restoreStrictLockTaskIfRequested()
                }
            }
        }
    }

    private fun requestHomeRoleIfNeeded(): Boolean {
        if (maintenanceRoute != RoomMaintenanceRoute.CLOSED || diagnosticsMode) return false
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
        val roleManager = getSystemService(RoleManager::class.java) ?: return false
        val preferences = getSharedPreferences(ROOM_KIOSK_PREFERENCES, MODE_PRIVATE)
        val requestAlreadyAttempted = preferences.getBoolean(HOME_ROLE_REQUEST_ATTEMPTED_KEY, false)
        if (!shouldRequestHomeRole(
                apiLevel = Build.VERSION.SDK_INT,
                hasRoomSession = roomSessionConfigured,
                roleAvailable = roleManager.isRoleAvailable(RoleManager.ROLE_HOME),
                roleHeld = roleManager.isRoleHeld(RoleManager.ROLE_HOME),
                requestAlreadyAttempted = requestAlreadyAttempted
            )
        ) return false

        markHomeRoleRequestAttempted()
        try {
            homeRoleRequestLauncher.launch(roleManager.createRequestRoleIntent(RoleManager.ROLE_HOME))
            return true
        } catch (error: Exception) {
            val message = "Android no pudo abrir la selección de la aplicación de inicio. Vuelve a intentarlo desde Mantenimiento o desde la configuración de Android."
            kioskControlMessage = message
            Toast.makeText(this, message, Toast.LENGTH_LONG).show()
            Log.w(TAG, "The HOME role request could not be opened; use Android Settings to select Hotel Alert as Home.", error)
            return false
        }
    }

    private fun markHomeRoleRequestAttempted() {
        getSharedPreferences(ROOM_KIOSK_PREFERENCES, MODE_PRIVATE)
            .edit()
            .putBoolean(HOME_ROLE_REQUEST_ATTEMPTED_KEY, true)
            .apply()
    }

    private fun refreshHomeSelectionStatus() {
        lifecycleScope.launch {
            val refreshedStatus = withContext(Dispatchers.IO) {
                runCatching { roomHomePolicy.readStatus().homeStatus }
                    .getOrDefault(RoomHomeStatus.UNKNOWN)
            }
            homeStatus = refreshedStatus
            val message = homeSelectionFeedbackMessage(homeSelectionFeedback(refreshedStatus))
            kioskControlMessage = message
            Toast.makeText(this@MainActivity, message, Toast.LENGTH_LONG).show()
            if (maintenanceRoute == RoomMaintenanceRoute.SETTINGS) refreshMaintenanceDeviceState()
        }
    }

    private fun refreshMaintenanceDeviceState() {
        if (maintenanceRoute != RoomMaintenanceRoute.SETTINGS || !roomSessionConfigured) return
        overlayPermissionGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            runCatching { Settings.canDrawOverlays(this) }.getOrDefault(false)
        lifecycleScope.launch {
            val state = withContext(Dispatchers.IO) {
                val home = runCatching { roomHomePolicy.readStatus() }.getOrNull()
                val preparation = runCatching {
                    roomLockTaskPolicy.prepareForRoomSession(hasRoomSession = true)
                }.getOrDefault(RoomLockTaskPreparation.POLICY_REJECTED)
                val strictReady = preparation == RoomLockTaskPreparation.POLICY_READY &&
                    runCatching {
                        roomLockTaskPolicy.isStrictModeReady(
                            hasRoomSession = true,
                            strictModeRequested = true,
                            maintenanceExitAvailable = true
                        )
                    }.getOrDefault(false)
                MaintenanceDeviceState(
                    homeStatus = home?.homeStatus ?: RoomHomeStatus.UNKNOWN,
                    isDeviceOwner = home?.isDeviceOwner ?: false,
                    roleAvailable = home?.roleAvailable ?: false,
                    strictModeAvailable = strictReady,
                    preparation = preparation
                )
            }
            homeStatus = state.homeStatus
            isDeviceOwner = state.isDeviceOwner
            homeRoleAvailable = state.roleAvailable
            strictModeAvailable = state.strictModeAvailable
            strictModeAvailabilityMessage = strictModeMessage(state.preparation)
            strictModeStatus = readRoomLockTaskStatus()
        }
    }

    private fun strictModeMessage(preparation: RoomLockTaskPreparation): String? = when (preparation) {
        RoomLockTaskPreparation.POLICY_READY -> null
        RoomLockTaskPreparation.DEVICE_OWNER_REQUIRED ->
            "El modo kiosco estricto requiere que Hotel Alert tenga privilegios de administración del dispositivo. El modo básico sigue disponible."
        RoomLockTaskPreparation.PACKAGE_NOT_ALLOWLISTED ->
            "Android no incluyó Hotel Alert entre las aplicaciones permitidas para el modo kiosco estricto. Esta función no está disponible."
        RoomLockTaskPreparation.POLICY_REJECTED ->
            "Android rechazó la política de administración del dispositivo. El modo kiosco estricto no está disponible."
        RoomLockTaskPreparation.ROOM_SESSION_REQUIRED ->
            "El modo kiosco estricto requiere una asignación activa de habitación."
        RoomLockTaskPreparation.ANDROID_VERSION_UNSUPPORTED ->
            "El modo kiosco estricto no está disponible en esta versión de Android."
    }

    private fun updateRoomWindowMode() {
        updateRoomWakeRecoverySuppression()
        applyRoomWindowBrightness()
        applyRoomKeepScreenOn()
        val immersive = shouldUseRoomImmersiveMode(
            hasRoomSession = roomSessionConfigured,
            hasServerOrigin = runCatching { component.serverOriginStore.read() != null }.getOrDefault(false),
            showDiagnostics = diagnosticsMode,
            maintenanceActive = maintenanceRoute != RoomMaintenanceRoute.CLOSED
        )
        WindowCompat.setDecorFitsSystemWindows(window, !immersive)
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        if (immersive) controller.hide(WindowInsetsCompat.Type.systemBars())
        else controller.show(WindowInsetsCompat.Type.systemBars())
    }

    private fun applyRoomKeepScreenOn() {
        val shouldKeepScreenOn = shouldKeepRoomScreenOn(
            hasRoomSession = roomSessionConfigured,
            hasServerOrigin = runCatching { component.serverOriginStore.read() != null }.getOrDefault(false),
            activityResumed = activityResumed,
            windowFocused = roomWindowFocused,
            showDiagnostics = diagnosticsMode,
            maintenanceActive = maintenanceRoute != RoomMaintenanceRoute.CLOSED || maintenanceSettingsRestorePending
        )
        if (shouldKeepScreenOn) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    private fun onRoomScreenTap() {
        val shouldOpenPin = maintenanceTapGate.onTap(
            hasRoomSession = roomSessionConfigured && !diagnosticsMode,
            maintenanceOpen = maintenanceRoute != RoomMaintenanceRoute.CLOSED,
            nowMillis = System.currentTimeMillis()
        )
        if (shouldOpenPin) {
            maintenanceSettingsRestorePending = false
            roomScreensaverRequested = false
            maintenancePinError = null
            maintenanceRoute = RoomMaintenanceRoute.PIN
            updateRoomWindowMode()
        }
    }

    private fun wakeRoomScreensaverDisplay(): Boolean {
        if (!roomScreensaverDisplayBlackout.value || !isRoomScreensaverBrightnessEligible()) return false
        roomScreensaverDisplayBlackout.value = false
        applyRoomWindowBrightness()
        return true
    }

    private fun verifyMaintenancePin(pin: String) {
        if (isCheckingMaintenancePin) return
        isCheckingMaintenancePin = true
        maintenancePinError = null
        lifecycleScope.launch {
            val verification = runCatching {
                withContext(Dispatchers.IO) {
                    maintenancePinStore.verify(pin, System.currentTimeMillis())
                }
            }
            isCheckingMaintenancePin = false
            verification.onSuccess { result ->
                when (result) {
                    is RoomMaintenancePinVerification.Accepted -> {
                        maintenancePinError = null
                        maintenancePinChangeMessage = null
                        kioskControlMessage = null
                        strictModeDraft = strictModePreference
                        roomScreenBrightnessDraft = roomScreenBrightnessPreference
                        maintenanceRoute = RoomMaintenanceRoute.SETTINGS
                        updateRoomWindowMode()
                        refreshMaintenanceDeviceState()
                    }
                    is RoomMaintenancePinVerification.Rejected -> {
                        maintenancePinError = "El PIN es incorrecto. Quedan ${result.attemptsRemaining} intentos."
                    }
                    is RoomMaintenancePinVerification.Locked -> {
                        val seconds = ((result.retryAfterMillis + 999) / 1_000).coerceAtLeast(1)
                        maintenancePinError = "Demasiados intentos. Vuelve a probar en $seconds segundos."
                    }
                }
            }.onFailure {
                maintenancePinError = "No se pudo verificar el PIN de configuración. Vuelve a intentarlo."
            }
        }
    }

    private fun changeMaintenancePin(pin: String) {
        if (maintenanceRoute != RoomMaintenanceRoute.SETTINGS) return
        lifecycleScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { maintenancePinStore.changePin(pin) }
            }.onSuccess {
                maintenancePinChangeMessage = "Se actualizó el PIN de configuración."
            }.onFailure {
                maintenancePinChangeMessage = "No se pudo guardar el PIN. Vuelve a intentarlo."
            }
        }
    }

    private fun chooseHotelAlertHome() {
        if (!isMaintenanceSettingsOpen()) return
        when (chooseHomeSelectionAction(Build.VERSION.SDK_INT, homeRoleAvailable, isDeviceOwner)) {
            HomeSelectionAction.SET_PERSISTENT_PREFERRED_HOME -> {
                if (!ensureRoomLockTaskExitedSafely()) return
                lifecycleScope.launch {
                    val selected = withContext(Dispatchers.IO) {
                        runCatching { roomHomePolicy.setPersistentPreferredHome() }.getOrDefault(false)
                    }
                    kioskControlMessage = if (selected) {
                        "Hotel Alert ahora es la aplicación de inicio administrada."
                    } else {
                        "Android no pudo establecer Hotel Alert como aplicación de inicio administrada."
                    }
                    refreshMaintenanceDeviceState()
                }
            }
            HomeSelectionAction.REQUEST_HOME_ROLE -> {
                if (!ensureRoomLockTaskExitedSafely()) return
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                    openHomeSelectionSettings()
                    return
                }
                val roleManager = getSystemService(RoleManager::class.java)
                if (roleManager?.isRoleAvailable(RoleManager.ROLE_HOME) != true) {
                    openHomeSelectionSettings()
                    return
                }
                markHomeRoleRequestAttempted()
                runCatching {
                    homeRoleRequestLauncher.launch(roleManager.createRequestRoleIntent(RoleManager.ROLE_HOME))
                }.onFailure {
                    kioskControlMessage = "Android no pudo abrir la pantalla de autorización de la aplicación de inicio."
                }
            }
            HomeSelectionAction.OPEN_HOME_SETTINGS -> openHomeSelectionSettings()
        }
    }

    private fun clearManagedHome() {
        if (!isMaintenanceSettingsOpen() || !isDeviceOwner) return
        lifecycleScope.launch {
            val cleared = withContext(Dispatchers.IO) {
                runCatching { roomHomePolicy.clearPersistentPreferredHome() }.getOrDefault(false)
            }
            kioskControlMessage = if (cleared) {
                "Se quitó la preferencia de inicio administrada de Hotel Alert. Arriba se muestra la aplicación predeterminada actual de Android."
            } else {
                "Android no pudo quitar la preferencia de inicio administrada."
            }
            refreshMaintenanceDeviceState()
        }
    }

    private fun openHomeSelectionSettings() {
        if (!isMaintenanceSettingsOpen() || !ensureRoomLockTaskExitedSafely()) return
        try {
            startActivity(Intent(Settings.ACTION_HOME_SETTINGS))
        } catch (_: Exception) {
            val fallbackMessage = "Los ajustes de la aplicación de inicio no están disponibles. Android abrirá la autorización de Hotel Alert; confirma allí si quieres seleccionarla."
            if (requestHomeRoleWithConsent(fallbackMessage)) {
                kioskControlMessage = fallbackMessage
                Toast.makeText(this, fallbackMessage, Toast.LENGTH_LONG).show()
            } else {
                kioskControlMessage = "No se pudieron abrir los ajustes de inicio ni la autorización de Hotel Alert. Usa la configuración general de Android para elegir la aplicación de inicio."
                runCatching { startActivity(Intent(Settings.ACTION_SETTINGS)) }
                    .onFailure { kioskControlMessage = "No se pudo abrir la configuración de Android en este dispositivo." }
            }
        }
    }

    private fun requestHomeRoleWithConsent(fallbackMessage: String): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
        val roleManager = getSystemService(RoleManager::class.java) ?: return false
        if (!roleManager.isRoleAvailable(RoleManager.ROLE_HOME)) return false
        kioskControlMessage = fallbackMessage
        markHomeRoleRequestAttempted()
        return runCatching {
            homeRoleRequestLauncher.launch(roleManager.createRequestRoleIntent(RoleManager.ROLE_HOME))
        }.onFailure {
            kioskControlMessage = "Android no pudo abrir la autorización de la aplicación de inicio."
        }.isSuccess
    }

    private fun openAndroidSettings() {
        if (!isMaintenanceSettingsOpen() || !ensureRoomLockTaskExitedSafely()) return
        runCatching {
            startActivity(Intent(Settings.ACTION_SETTINGS))
        }.onFailure {
            kioskControlMessage = "No se pudo abrir la configuración de Android en este dispositivo."
        }
    }

    private fun openWirelessDebuggingSettings() {
        if (!isMaintenanceSettingsOpen() || !ensureRoomLockTaskExitedSafely()) return
        try {
            startActivity(Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS))
        } catch (_: ActivityNotFoundException) {
            openGeneralSettingsForWirelessDebugging()
        } catch (error: Exception) {
            Log.w(TAG, "Android developer settings could not be opened.", error)
            openGeneralSettingsForWirelessDebugging()
        }
    }

    private fun openGeneralSettingsForWirelessDebugging() {
        kioskControlMessage = "Las opciones de desarrollador no están disponibles. Se abrirá la configuración general de Android; busca allí las opciones de desarrollador."
        runCatching { startActivity(Intent(Settings.ACTION_SETTINGS)) }
            .onFailure {
                kioskControlMessage = "No se pudieron abrir las opciones de desarrollador ni la configuración de Android."
            }
    }

    private fun openOverlayPermissionSettings() {
        if (!isMaintenanceSettingsOpen() || !ensureRoomLockTaskExitedSafely()) return
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            kioskControlMessage = "Esta versión de Android no requiere el permiso de superposición para el intento de recuperación al activar la pantalla."
            return
        }
        try {
            startActivity(
                Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName")
                )
            )
        } catch (_: ActivityNotFoundException) {
            kioskControlMessage = "Android no ofreció una pantalla específica para el permiso de superposición. Se abrirá la configuración general."
            runCatching { startActivity(Intent(Settings.ACTION_SETTINGS)) }
                .onFailure { kioskControlMessage = "No se pudo abrir la configuración del permiso de superposición en este dispositivo." }
        } catch (error: Exception) {
            Log.w(TAG, "Android overlay-access settings could not be opened.", error)
            kioskControlMessage = "No se pudo abrir la configuración del permiso de superposición en este dispositivo."
        }
    }

    private fun ensureRoomLockTaskExitedSafely(): Boolean {
        val currentStatus = readRoomLockTaskStatus()
        strictModeStatus = currentStatus
        val owner = runCatching { roomLockTaskPolicy.isDeviceOwner() }.getOrDefault(false)
        when (
            roomLockTaskMaintenanceExitAction(
                status = currentStatus,
                startedByThisActivity = lockTaskStartedByThisActivity,
                isDeviceOwner = owner
            )
        ) {
            RoomLockTaskMaintenanceExitAction.ALREADY_INACTIVE -> {
                lockTaskStartedByThisActivity = false
                return true
            }
            RoomLockTaskMaintenanceExitAction.BLOCK_SCREEN_PINNING -> {
                kioskControlMessage = "El anclaje de pantalla de Android está activo. Desactívalo antes de abrir otra aplicación."
                return false
            }
            RoomLockTaskMaintenanceExitAction.BLOCK_UNKNOWN_STATUS -> {
                kioskControlMessage = "Android no pudo confirmar el estado del modo kiosco estricto. No se abrió otra aplicación."
                return false
            }
            RoomLockTaskMaintenanceExitAction.BLOCK_UNOWNED_STRICT_LOCK_TASK -> {
                kioskControlMessage = "El modo kiosco estricto está activo, pero no se puede detener de forma segura sin privilegios de administración del dispositivo."
                return false
            }
            RoomLockTaskMaintenanceExitAction.STOP_ACTIVITY_OWNED_LOCK_TASK -> {
                val stopped = runCatching {
                    stopLockTask()
                    true
                }.getOrDefault(false)
                if (!stopped) {
                    kioskControlMessage = "No se pudo detener el modo kiosco estricto de forma segura. No se abrió otra aplicación."
                    return false
                }
            }
            RoomLockTaskMaintenanceExitAction.REMOVE_DEVICE_OWNER_ALLOWLIST -> {
                val removed = runCatching {
                    roomLockTaskPolicy.removeAppFromLockTaskAllowlistForMaintenance()
                }.getOrDefault(false)
                if (!removed) {
                    kioskControlMessage = "La administración del dispositivo no pudo quitar Hotel Alert del modo kiosco estricto de forma segura. No se abrió otra aplicación."
                    return false
                }
            }
        }

        val statusAfterExit = readRoomLockTaskStatus()
        strictModeStatus = statusAfterExit
        if (mayLaunchExternalActivityAfterRoomLockTaskExit(statusAfterExit)) {
            lockTaskStartedByThisActivity = false
            return true
        }

        kioskControlMessage = when (statusAfterExit) {
            RoomLockTaskStatus.SCREEN_PINNING ->
                "El anclaje de pantalla de Android está activo. Desactívalo antes de abrir otra aplicación."
            RoomLockTaskStatus.UNKNOWN ->
                "Android no pudo confirmar que se haya detenido el modo kiosco estricto. No se abrió otra aplicación."
            else -> "El modo kiosco estricto sigue activo. No se abrió otra aplicación."
        }
        return false
    }

    private fun saveMaintenanceAndReturn() {
        if (!isMaintenanceSettingsOpen()) return
        val preferences = getSharedPreferences(ROOM_KIOSK_PREFERENCES, MODE_PRIVATE)
        val normalizedBrightnessPreference = normalizedRoomScreenBrightnessPreference(
            manualEnabled = roomScreenBrightnessDraft.manualEnabled,
            levelPercent = roomScreenBrightnessDraft.levelPercent
        )
        val saveSucceeded = runCatching {
            preferences.edit()
                .putBoolean(STRICT_ROOM_LOCK_TASK_KEY, strictModeDraft)
                .putBoolean(ROOM_SCREEN_BRIGHTNESS_MANUAL_KEY, normalizedBrightnessPreference.manualEnabled)
                .putInt(ROOM_SCREEN_BRIGHTNESS_LEVEL_PERCENT_KEY, normalizedBrightnessPreference.levelPercent)
                .commit()
        }.getOrDefault(false)
        if (!saveSucceeded) {
            kioskControlMessage = "No se pudo guardar la configuración. Permanece aquí y vuelve a intentarlo."
            return
        }

        strictModePreference = strictModeDraft
        roomScreenBrightnessPreference = normalizedBrightnessPreference
        roomScreenBrightnessDraft = normalizedBrightnessPreference
        if (!strictModePreference && !ensureRoomLockTaskExitedSafely()) return

        maintenanceSettingsRestorePending = false
        maintenanceRoute = RoomMaintenanceRoute.CLOSED
        maintenancePinError = null
        maintenancePinChangeMessage = null
        kioskControlMessage = null
        updateRoomWindowMode()

        if (strictModePreference && strictModeAvailable) {
            window.decorView.post { startStrictLockTaskIfRequested(reopenMaintenanceOnFailure = true) }
        }
    }

    private fun restoreStrictLockTaskIfRequested() {
        if (!strictModePreference || diagnosticsMode || maintenanceRoute != RoomMaintenanceRoute.CLOSED) return
        startStrictLockTaskIfRequested(reopenMaintenanceOnFailure = false)
    }

    private fun startStrictLockTaskIfRequested(reopenMaintenanceOnFailure: Boolean) {
        lifecycleScope.launch {
            val readiness = withContext(Dispatchers.IO) {
                if (!roomSessionConfigured) {
                    return@withContext RoomLockTaskPreparation.ROOM_SESSION_REQUIRED to false
                }
                val preparation = roomLockTaskPolicy.prepareForRoomSession(hasRoomSession = true)
                preparation to (preparation == RoomLockTaskPreparation.POLICY_READY &&
                    roomLockTaskPolicy.isStrictModeReady(
                        hasRoomSession = true,
                        strictModeRequested = true,
                        maintenanceExitAvailable = true
                    ))
            }
            val (preparation, ready) = readiness
            if (!shouldRestoreStrictRoomLockTask(
                hasRoomSession = roomSessionConfigured,
                strictModeRequested = strictModePreference,
                    maintenanceActive = diagnosticsMode || maintenanceRoute != RoomMaintenanceRoute.CLOSED,
                    policyReady = ready
                )
            ) {
                if (reopenMaintenanceOnFailure && roomSessionConfigured && strictModePreference) {
                    maintenanceRoute = RoomMaintenanceRoute.SETTINGS
                    strictModeAvailabilityMessage = strictModeMessage(preparation)
                    kioskControlMessage = "El modo kiosco estricto no está disponible. La habitación permanece en el modo básico."
                    updateRoomWindowMode()
                    refreshMaintenanceDeviceState()
                }
                return@launch
            }

            strictModeStatus = readRoomLockTaskStatus()
            if (strictModeStatus == RoomLockTaskStatus.STRICT_LOCKED) return@launch
            if (strictModeStatus == RoomLockTaskStatus.SCREEN_PINNING) {
                Log.w(TAG, "Strict Lock Task was not started because Android screen pinning is active.")
                if (reopenMaintenanceOnFailure) {
                    maintenanceRoute = RoomMaintenanceRoute.SETTINGS
                    kioskControlMessage = "Desactiva el anclaje de pantalla de Android antes de activar el modo kiosco estricto."
                    updateRoomWindowMode()
                    refreshMaintenanceDeviceState()
                }
                return@launch
            }

            runCatching {
                startLockTask()
                lockTaskStartedByThisActivity = true
                strictModeStatus = readRoomLockTaskStatus()
                if (strictModeStatus != RoomLockTaskStatus.STRICT_LOCKED) {
                    window.decorView.post {
                        strictModeStatus = readRoomLockTaskStatus()
                        if (strictModeStatus != RoomLockTaskStatus.STRICT_LOCKED) {
                            Log.w(TAG, "Android did not confirm strict ROOM Lock Task mode.")
                            if (reopenMaintenanceOnFailure &&
                                roomSessionConfigured &&
                                maintenanceRoute == RoomMaintenanceRoute.CLOSED
                            ) {
                                maintenanceRoute = RoomMaintenanceRoute.SETTINGS
                                kioskControlMessage = "Android no confirmó el modo kiosco estricto. La habitación permanece en el modo básico."
                                updateRoomWindowMode()
                                refreshMaintenanceDeviceState()
                            }
                        }
                    }
                }
            }.onFailure { error ->
                lockTaskStartedByThisActivity = false
                Log.w(TAG, "Android did not enter strict ROOM Lock Task mode.", error)
                if (reopenMaintenanceOnFailure && roomSessionConfigured) {
                    maintenanceRoute = RoomMaintenanceRoute.SETTINGS
                    kioskControlMessage = "Android no confirmó el modo kiosco estricto. La habitación permanece en el modo básico."
                    updateRoomWindowMode()
                    refreshMaintenanceDeviceState()
                }
            }
        }
    }

    private fun readRoomLockTaskStatus(): RoomLockTaskStatus {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return RoomLockTaskStatus.UNKNOWN
        val manager = getSystemService(ActivityManager::class.java) ?: return RoomLockTaskStatus.UNKNOWN
        return roomLockTaskStatus(
            isLockedMode = manager.lockTaskModeState == ActivityManager.LOCK_TASK_MODE_LOCKED,
            isPinnedMode = manager.lockTaskModeState == ActivityManager.LOCK_TASK_MODE_PINNED
        )
    }

    private fun isMaintenanceSettingsOpen(): Boolean =
        maintenanceRoute == RoomMaintenanceRoute.SETTINGS && roomSessionConfigured

    private fun applyRoomWindowBrightness() {
        val hasServerOrigin = hasConfiguredServerOrigin()
        val isScreensaverBrightnessEligible = isRoomScreensaverBrightnessEligible(hasServerOrigin)
        val brightnessPreference = if (maintenanceRoute == RoomMaintenanceRoute.SETTINGS) {
            roomScreenBrightnessDraft
        } else {
            roomScreenBrightnessPreference
        }
        synchronizeRoomScreensaverBrightnessStep(
            isEligible = isScreensaverBrightnessEligible,
            configuredBrightnessPercent = brightnessPreference.levelPercent
        )
        val brightness = roomWindowBrightnessOverride(
            preference = brightnessPreference,
            isForeground = activityResumed && roomWindowFocused,
            isRoomScreensaverActive = isScreensaverBrightnessEligible,
            screensaverBrightnessPercent = roomScreensaverBrightnessPercent,
            isRoomScreensaverDisplayBlack = roomScreensaverDisplayBlackout.value
        )
        val attributes = window.attributes
        if (attributes.screenBrightness != brightness) {
            attributes.screenBrightness = brightness
            window.attributes = attributes
        }
        val maintenanceActive = maintenanceRoute != RoomMaintenanceRoute.CLOSED || maintenanceSettingsRestorePending
        val diagnostic = "request=$roomScreensaverRequested eligible=$isScreensaverBrightnessEligible " +
            "resumed=$activityResumed focused=$roomWindowFocused sessionConfigured=$roomSessionConfigured " +
            "diagnostics=$diagnosticsMode maintenance=$maintenanceActive serverOrigin=$hasServerOrigin " +
            "blackout=${roomScreensaverDisplayBlackout.value} override=$brightness assigned=${window.attributes.screenBrightness}"
        if (diagnostic != lastRoomScreensaverBrightnessDiagnostic) {
            Log.i(TAG, "ROOM_SAVER_BRIGHTNESS $diagnostic")
            lastRoomScreensaverBrightnessDiagnostic = diagnostic
        }
    }

    private fun isRoomScreensaverBrightnessEligible(
        hasServerOrigin: Boolean = hasConfiguredServerOrigin()
    ): Boolean = shouldApplyRoomScreensaverBrightness(
        requestedByWebView = roomScreensaverRequested,
        readiness = RoomScreensaverBrightnessReadiness(
            activityResumed = activityResumed,
            windowFocused = roomWindowFocused,
            diagnosticsMode = diagnosticsMode,
            maintenanceActive = maintenanceRoute != RoomMaintenanceRoute.CLOSED || maintenanceSettingsRestorePending,
            hasServerOrigin = hasServerOrigin
        )
    )

    private fun hasConfiguredServerOrigin(): Boolean =
        runCatching { component.serverOriginStore.read() != null }.getOrDefault(false)

    private fun synchronizeRoomScreensaverBrightnessStep(isEligible: Boolean, configuredBrightnessPercent: Int) {
        if (!isEligible) {
            cancelRoomScreensaverBrightnessStep()
            roomScreensaverBrightnessPercent = roomScreensaverBrightnessStartPercent(configuredBrightnessPercent)
            roomScreensaverDisplayBlackout.value = false
            roomScreensaverBrightnessWasEligible = false
            return
        }
        if (!roomScreensaverBrightnessWasEligible) {
            roomScreensaverBrightnessPercent = roomScreensaverBrightnessStartPercent(configuredBrightnessPercent)
            roomScreensaverDisplayBlackout.value = false
            roomScreensaverBrightnessWasEligible = true
        }
        if (!roomScreensaverBrightnessStepScheduled &&
            roomScreensaverBrightnessPercent > ROOM_SCREENSAVER_BRIGHTNESS_FLOOR_PERCENT
        ) {
            roomScreensaverBrightnessStepScheduled = roomScreensaverBrightnessHandler.postDelayed(
                roomScreensaverBrightnessStep,
                ROOM_SCREENSAVER_BRIGHTNESS_STEP_DELAY_MILLIS
            )
        }
    }

    private fun cancelRoomScreensaverBrightnessStep() {
        roomScreensaverBrightnessHandler.removeCallbacks(roomScreensaverBrightnessStep)
        roomScreensaverBrightnessStepScheduled = false
    }

    private fun closeMaintenance() {
        maintenanceSettingsRestorePending = false
        maintenanceRoute = RoomMaintenanceRoute.CLOSED
        maintenancePinError = null
        maintenancePinChangeMessage = null
        kioskControlMessage = null
        strictModeDraft = strictModePreference
        roomScreenBrightnessDraft = roomScreenBrightnessPreference
        updateRoomWindowMode()
    }

    companion object {
        const val EXTRA_EVENT_ID = "eventId"
        const val EXTRA_REQUEST_ID = "requestId"
        const val EXTRA_START_REQUEST_ID = "startRequestId"
        const val EXTRA_AREA_ID = "areaId"
        const val EXTRA_SHOW_DIAGNOSTICS = "showDiagnostics"
        private const val NOTIFICATION_PERMISSION_REQUEST_CODE = 1001
        private const val ROOM_KIOSK_PREFERENCES = "hotel_alert_room_kiosk"
        private const val HOME_ROLE_REQUEST_ATTEMPTED_KEY = "home_role_request_attempted"
        private const val STRICT_ROOM_LOCK_TASK_KEY = "strict_room_lock_task_requested"
        private const val ROOM_SCREEN_BRIGHTNESS_MANUAL_KEY = "room_screen_brightness_manual"
        private const val ROOM_SCREEN_BRIGHTNESS_LEVEL_PERCENT_KEY = "room_screen_brightness_level_percent"
        private const val STATE_MAINTENANCE_SETTINGS_OPEN_KEY = "room_maintenance_settings_open"
        private const val TAG = "HotelAlertMainActivity"

        @Volatile
        private var appInForeground = false
        @Volatile
        private var activityVisible = false
        @Volatile
        private var maintenanceActiveForWakeRecovery = false
        @Volatile
        private var diagnosticsModeForWakeRecovery = false

        fun startRequestIntent(context: Context, requestId: String): Intent =
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(EXTRA_START_REQUEST_ID, notificationStartRequestId(requestId))
            }

        internal fun isAppInForeground(): Boolean = appInForeground
        internal fun isActivityVisible(): Boolean = activityVisible
        internal fun isMaintenanceActiveForWakeRecovery(): Boolean = maintenanceActiveForWakeRecovery
        internal fun isDiagnosticsModeForWakeRecovery(): Boolean = diagnosticsModeForWakeRecovery

        private fun setAppInForeground(value: Boolean) {
            appInForeground = value
        }

        private fun setActivityVisible(value: Boolean) {
            activityVisible = value
        }
    }

    private fun updateRoomWakeRecoverySuppression() {
        maintenanceActiveForWakeRecovery = maintenanceRoute != RoomMaintenanceRoute.CLOSED ||
            maintenanceSettingsRestorePending
        diagnosticsModeForWakeRecovery = diagnosticsMode
    }
}

private data class MaintenanceDeviceState(
    val homeStatus: RoomHomeStatus,
    val isDeviceOwner: Boolean,
    val roleAvailable: Boolean,
    val strictModeAvailable: Boolean,
    val preparation: RoomLockTaskPreparation
)

private enum class RoomMaintenanceRoute { CLOSED, PIN, SETTINGS }

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
