package com.hotelalert.notificationreceiver

import android.Manifest
import android.app.Activity
import android.app.ActivityManager
import android.app.role.RoleManager
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
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
    private var strictModeAvailable by mutableStateOf(false)
    private var strictModeAvailabilityMessage by mutableStateOf<String?>(null)
    private var strictModeStatus by mutableStateOf(RoomLockTaskStatus.INACTIVE)
    private var kioskControlMessage by mutableStateOf<String?>(null)
    private var strictModePreference = false
    private var lockTaskStartedByThisActivity = false
    private val maintenanceTapGate = RoomMaintenanceTapGate()
    private val maintenancePinStore by lazy { AndroidRoomMaintenancePinStore(applicationContext) }
    private val roomHomePolicy by lazy { AndroidRoomHomePolicy(applicationContext) }
    private val roomLockTaskPolicy by lazy { AndroidRoomLockTaskDevicePolicy(applicationContext) }

    private val homeRoleRequestLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (maintenanceRoute == RoomMaintenanceRoute.SETTINGS) {
            kioskControlMessage = if (result.resultCode == Activity.RESULT_OK) {
                "Android accepted the Home-app selection."
            } else {
                "Home-app selection was not changed."
            }
            refreshMaintenanceDeviceState()
        }
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
        strictModePreference = getSharedPreferences(ROOM_KIOSK_PREFERENCES, MODE_PRIVATE)
            .getBoolean(STRICT_ROOM_LOCK_TASK_KEY, false)
        strictModeDraft = strictModePreference
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
                    Box(Modifier.fillMaxSize()) {
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
                            },
                            onScreenTap = ::onRoomScreenTap
                        )
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
                                    onChooseHome = ::chooseHotelAlertHome,
                                    onClearManagedHome = ::clearManagedHome,
                                    onOpenAndroidSettings = ::openAndroidSettings,
                                    onStrictModeChange = { strictModeDraft = it },
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
        if (diagnosticsMode) {
            maintenanceSettingsRestorePending = false
            maintenanceRoute = RoomMaintenanceRoute.CLOSED
        }
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
                } else {
                    maintenanceRoute = RoomMaintenanceRoute.CLOSED
                    maintenancePinError = null
                    maintenancePinChangeMessage = null
                }
            }
            if ((!roomSessionConfigured || diagnosticsMode) && maintenanceRoute != RoomMaintenanceRoute.CLOSED) {
                maintenanceRoute = RoomMaintenanceRoute.CLOSED
                maintenancePinError = null
                maintenancePinChangeMessage = null
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

        try {
            homeRoleRequestLauncher.launch(roleManager.createRequestRoleIntent(RoleManager.ROLE_HOME))
            preferences.edit().putBoolean(HOME_ROLE_REQUEST_ATTEMPTED_KEY, true).apply()
            return true
        } catch (error: Exception) {
            Log.w(TAG, "The HOME role request could not be opened; use Android Settings to select Hotel Alert as Home.", error)
            return false
        }
    }

    private fun refreshMaintenanceDeviceState() {
        if (maintenanceRoute != RoomMaintenanceRoute.SETTINGS || !roomSessionConfigured) return
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
            "Strict Lock Task requires Hotel Alert to be provisioned as Device Owner. Basic mode remains available."
        RoomLockTaskPreparation.PACKAGE_NOT_ALLOWLISTED ->
            "Android did not allowlist Hotel Alert for Lock Task. Strict mode is unavailable."
        RoomLockTaskPreparation.POLICY_REJECTED ->
            "Android rejected the Device Owner policy. Strict mode is unavailable."
        RoomLockTaskPreparation.ROOM_SESSION_REQUIRED ->
            "Strict Lock Task requires an active ROOM assignment."
        RoomLockTaskPreparation.ANDROID_VERSION_UNSUPPORTED ->
            "Strict Lock Task is unavailable on this Android version."
    }

    private fun updateRoomWindowMode() {
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

    private fun onRoomScreenTap() {
        val shouldOpenPin = maintenanceTapGate.onTap(
            hasRoomSession = roomSessionConfigured && !diagnosticsMode,
            maintenanceOpen = maintenanceRoute != RoomMaintenanceRoute.CLOSED,
            nowMillis = System.currentTimeMillis()
        )
        if (shouldOpenPin) {
            maintenanceSettingsRestorePending = false
            maintenancePinError = null
            maintenanceRoute = RoomMaintenanceRoute.PIN
            updateRoomWindowMode()
        }
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
                        maintenanceRoute = RoomMaintenanceRoute.SETTINGS
                        updateRoomWindowMode()
                        refreshMaintenanceDeviceState()
                    }
                    is RoomMaintenancePinVerification.Rejected -> {
                        maintenancePinError = "Incorrect PIN. ${result.attemptsRemaining} attempts remain."
                    }
                    is RoomMaintenancePinVerification.Locked -> {
                        val seconds = ((result.retryAfterMillis + 999) / 1_000).coerceAtLeast(1)
                        maintenancePinError = "Too many attempts. Try again in $seconds seconds."
                    }
                }
            }.onFailure {
                maintenancePinError = "The configuration PIN could not be checked. Please try again."
            }
        }
    }

    private fun changeMaintenancePin(pin: String) {
        if (maintenanceRoute != RoomMaintenanceRoute.SETTINGS) return
        lifecycleScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { maintenancePinStore.changePin(pin) }
            }.onSuccess {
                maintenancePinChangeMessage = "Configuration PIN updated."
            }.onFailure {
                maintenancePinChangeMessage = "The PIN could not be saved. Please try again."
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
                        "Hotel Alert is now the managed Home app."
                    } else {
                        "Android could not set Hotel Alert as the managed Home app."
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
                runCatching {
                    homeRoleRequestLauncher.launch(roleManager.createRequestRoleIntent(RoleManager.ROLE_HOME))
                }.onFailure {
                    kioskControlMessage = "Android could not open the Home-app consent screen."
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
                "Hotel Alert's managed Home preference was cleared. Android's current default is shown above."
            } else {
                "Android could not clear the managed Home preference."
            }
            refreshMaintenanceDeviceState()
        }
    }

    private fun openHomeSelectionSettings() {
        if (!isMaintenanceSettingsOpen() || !ensureRoomLockTaskExitedSafely()) return
        try {
            startActivity(Intent(Settings.ACTION_HOME_SETTINGS))
        } catch (_: ActivityNotFoundException) {
            kioskControlMessage = "Home-app settings are unavailable; opening general Android Settings instead."
            runCatching { startActivity(Intent(Settings.ACTION_SETTINGS)) }
                .onFailure { kioskControlMessage = "Android Settings could not be opened on this device." }
        }
    }

    private fun openAndroidSettings() {
        if (!isMaintenanceSettingsOpen() || !ensureRoomLockTaskExitedSafely()) return
        runCatching {
            startActivity(Intent(Settings.ACTION_SETTINGS))
        }.onFailure {
            kioskControlMessage = "Android Settings could not be opened on this device."
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
                kioskControlMessage = "Android screen pinning is active; exit it before opening another app."
                return false
            }
            RoomLockTaskMaintenanceExitAction.BLOCK_UNKNOWN_STATUS -> {
                kioskControlMessage = "Android could not confirm the Lock Task state. Another app was not opened."
                return false
            }
            RoomLockTaskMaintenanceExitAction.BLOCK_UNOWNED_STRICT_LOCK_TASK -> {
                kioskControlMessage = "Strict Lock Task is active but cannot be safely stopped without Device Owner access."
                return false
            }
            RoomLockTaskMaintenanceExitAction.STOP_ACTIVITY_OWNED_LOCK_TASK -> {
                val stopped = runCatching {
                    stopLockTask()
                    true
                }.getOrDefault(false)
                if (!stopped) {
                    kioskControlMessage = "Lock Task could not be stopped safely. Another app was not opened."
                    return false
                }
            }
            RoomLockTaskMaintenanceExitAction.REMOVE_DEVICE_OWNER_ALLOWLIST -> {
                val removed = runCatching {
                    roomLockTaskPolicy.removeAppFromLockTaskAllowlistForMaintenance()
                }.getOrDefault(false)
                if (!removed) {
                    kioskControlMessage = "Device Owner could not safely remove Hotel Alert from Lock Task. Another app was not opened."
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
                "Android screen pinning is active; exit it before opening another app."
            RoomLockTaskStatus.UNKNOWN ->
                "Android could not confirm that Lock Task ended. Another app was not opened."
            else -> "Strict Lock Task is still active. Another app was not opened."
        }
        return false
    }

    private fun saveMaintenanceAndReturn() {
        if (!isMaintenanceSettingsOpen()) return
        val preferences = getSharedPreferences(ROOM_KIOSK_PREFERENCES, MODE_PRIVATE)
        val saveSucceeded = runCatching {
            preferences.edit().putBoolean(STRICT_ROOM_LOCK_TASK_KEY, strictModeDraft).commit()
        }.getOrDefault(false)
        if (!saveSucceeded) {
            kioskControlMessage = "Kiosk settings could not be saved. Stay here and try again."
            return
        }

        strictModePreference = strictModeDraft
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
                    kioskControlMessage = "Strict Lock Task is unavailable. ROOM remains in Basic mode."
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
                    kioskControlMessage = "Exit Android screen pinning before enabling strict Lock Task."
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
                                kioskControlMessage = "Android did not confirm strict Lock Task. ROOM remains in Basic mode."
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
                    kioskControlMessage = "Android did not confirm strict Lock Task. ROOM remains in Basic mode."
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

    private fun closeMaintenance() {
        maintenanceSettingsRestorePending = false
        maintenanceRoute = RoomMaintenanceRoute.CLOSED
        maintenancePinError = null
        maintenancePinChangeMessage = null
        kioskControlMessage = null
        strictModeDraft = strictModePreference
        updateRoomWindowMode()
    }

    companion object {
        const val EXTRA_EVENT_ID = "eventId"
        const val EXTRA_REQUEST_ID = "requestId"
        const val EXTRA_AREA_ID = "areaId"
        const val EXTRA_SHOW_DIAGNOSTICS = "showDiagnostics"
        private const val NOTIFICATION_PERMISSION_REQUEST_CODE = 1001
        private const val ROOM_KIOSK_PREFERENCES = "hotel_alert_room_kiosk"
        private const val HOME_ROLE_REQUEST_ATTEMPTED_KEY = "home_role_request_attempted"
        private const val STRICT_ROOM_LOCK_TASK_KEY = "strict_room_lock_task_requested"
        private const val STATE_MAINTENANCE_SETTINGS_OPEN_KEY = "room_maintenance_settings_open"
        private const val TAG = "HotelAlertMainActivity"

        @Volatile
        private var appInForeground = false

        internal fun isAppInForeground(): Boolean = appInForeground

        private fun setAppInForeground(value: Boolean) {
            appInForeground = value
        }
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
