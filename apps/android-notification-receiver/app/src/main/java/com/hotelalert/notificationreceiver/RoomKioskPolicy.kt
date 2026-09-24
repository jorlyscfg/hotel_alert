package com.hotelalert.notificationreceiver

internal fun shouldUseRoomImmersiveMode(
    hasRoomSession: Boolean,
    hasServerOrigin: Boolean,
    showDiagnostics: Boolean,
    maintenanceActive: Boolean = false
): Boolean = hasRoomSession && hasServerOrigin && !showDiagnostics && !maintenanceActive

internal fun shouldRequestHomeRole(
    apiLevel: Int,
    hasRoomSession: Boolean,
    roleAvailable: Boolean,
    roleHeld: Boolean,
    requestAlreadyAttempted: Boolean
): Boolean = apiLevel >= 29 && hasRoomSession && roleAvailable && !roleHeld && !requestAlreadyAttempted

internal fun shouldRestoreRoomPresence(action: String?, hasRoomSession: Boolean): Boolean =
    hasRoomSession && action != null && action in ROOM_PRESENCE_RESTORE_ACTIONS

internal fun shouldAttemptRoomWakeRecovery(
    apiLevel: Int,
    hasRoomSession: Boolean,
    screenInteractive: Boolean,
    appVisible: Boolean,
    maintenanceActive: Boolean,
    diagnosticsMode: Boolean,
    overlayPermissionGranted: Boolean
): Boolean = hasRoomSession && screenInteractive && !appVisible && !maintenanceActive && !diagnosticsMode &&
    (apiLevel < 29 || overlayPermissionGranted)

internal class RoomWakeCycleGate {
    private var generation = 0
    private var attemptedForCurrentWake = true
    private var initialized = false

    @Synchronized
    fun initializeForCurrentScreenState(screenInteractive: Boolean) {
        if (initialized) return
        attemptedForCurrentWake = screenInteractive
        initialized = true
    }

    @Synchronized
    fun onScreenOff() {
        generation += 1
        attemptedForCurrentWake = false
        initialized = true
    }

    @Synchronized
    fun claimScreenOnAttempt(): Int? {
        if (!initialized || attemptedForCurrentWake) return null
        attemptedForCurrentWake = true
        initialized = true
        return generation
    }

    @Synchronized
    fun isCurrentWake(expectedGeneration: Int): Boolean = generation == expectedGeneration
}

internal const val ACTION_BOOT_COMPLETED = "android.intent.action.BOOT_COMPLETED"
internal const val ACTION_MY_PACKAGE_REPLACED = "android.intent.action.MY_PACKAGE_REPLACED"

private val ROOM_PRESENCE_RESTORE_ACTIONS = setOf(
    ACTION_BOOT_COMPLETED,
    ACTION_MY_PACKAGE_REPLACED
)
