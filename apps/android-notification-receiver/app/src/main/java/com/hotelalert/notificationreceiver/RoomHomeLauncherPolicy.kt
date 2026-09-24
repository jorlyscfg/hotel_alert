package com.hotelalert.notificationreceiver

internal enum class HomeSelectionAction {
    REQUEST_HOME_ROLE,
    OPEN_HOME_SETTINGS,
    SET_PERSISTENT_PREFERRED_HOME
}

internal enum class RoomHomeStatus {
    HOTEL_ALERT_DEFAULT,
    ANOTHER_APP_DEFAULT,
    UNKNOWN
}

internal enum class HomeSelectionFeedback {
    CONFIRMED,
    NOT_CONFIRMED,
    UNKNOWN
}

internal fun homeSelectionFeedback(status: RoomHomeStatus): HomeSelectionFeedback = when (status) {
    RoomHomeStatus.HOTEL_ALERT_DEFAULT -> HomeSelectionFeedback.CONFIRMED
    RoomHomeStatus.ANOTHER_APP_DEFAULT -> HomeSelectionFeedback.NOT_CONFIRMED
    RoomHomeStatus.UNKNOWN -> HomeSelectionFeedback.UNKNOWN
}

internal fun homeSelectionFeedbackMessage(feedback: HomeSelectionFeedback): String = when (feedback) {
    HomeSelectionFeedback.CONFIRMED ->
        "Selección confirmada: Hotel Alert es la aplicación de inicio predeterminada."
    HomeSelectionFeedback.NOT_CONFIRMED ->
        "Selección no confirmada: Android mantiene otra aplicación como inicio predeterminado."
    HomeSelectionFeedback.UNKNOWN ->
        "Android no confirmó cuál es la aplicación de inicio predeterminada. Compruébalo en la configuración de Android."
}

internal fun chooseHomeSelectionAction(
    apiLevel: Int,
    roleAvailable: Boolean,
    isDeviceOwner: Boolean
): HomeSelectionAction = when {
    isDeviceOwner -> HomeSelectionAction.SET_PERSISTENT_PREFERRED_HOME
    apiLevel >= 29 && roleAvailable -> HomeSelectionAction.REQUEST_HOME_ROLE
    else -> HomeSelectionAction.OPEN_HOME_SETTINGS
}

internal fun resolveRoomHomeStatus(
    apiLevel: Int,
    roleAvailable: Boolean,
    roleHeldByHotelAlert: Boolean,
    resolvedHomePackage: String?,
    hotelAlertPackage: String
): RoomHomeStatus {
    val isHotelAlertDefault = when {
        roleAvailable && roleHeldByHotelAlert -> true
        resolvedHomePackage != null -> resolvedHomePackage == hotelAlertPackage
        apiLevel >= 29 && roleAvailable -> roleHeldByHotelAlert
        else -> null
    }
    return when (isHotelAlertDefault) {
        true -> RoomHomeStatus.HOTEL_ALERT_DEFAULT
        false -> RoomHomeStatus.ANOTHER_APP_DEFAULT
        null -> RoomHomeStatus.UNKNOWN
    }
}

internal fun shouldSetPersistentPreferredHome(isDeviceOwner: Boolean): Boolean = isDeviceOwner

internal fun shouldClearPersistentPreferredHome(isDeviceOwner: Boolean): Boolean = isDeviceOwner

internal fun shouldRestoreStrictRoomLockTask(
    hasRoomSession: Boolean,
    strictModeRequested: Boolean,
    maintenanceActive: Boolean,
    policyReady: Boolean
): Boolean = hasRoomSession && strictModeRequested && !maintenanceActive && policyReady

internal fun shouldRestorePinAuthorizedMaintenanceSettings(
    settingsWereOpenWhenActivityWasSaved: Boolean,
    hasRoomSession: Boolean,
    diagnosticsMode: Boolean
): Boolean = settingsWereOpenWhenActivityWasSaved && hasRoomSession && !diagnosticsMode

internal fun shouldPersistPinAuthorizedMaintenanceSettingsMarker(
    settingsAreOpen: Boolean,
    restoreIsPending: Boolean,
    hasRoomSession: Boolean,
    diagnosticsMode: Boolean
): Boolean = !diagnosticsMode && (restoreIsPending || (settingsAreOpen && hasRoomSession))

internal enum class RoomLockTaskStatus {
    INACTIVE,
    STRICT_LOCKED,
    SCREEN_PINNING,
    UNKNOWN
}

internal fun roomLockTaskStatus(isLockedMode: Boolean, isPinnedMode: Boolean): RoomLockTaskStatus = when {
    isLockedMode -> RoomLockTaskStatus.STRICT_LOCKED
    isPinnedMode -> RoomLockTaskStatus.SCREEN_PINNING
    else -> RoomLockTaskStatus.INACTIVE
}

internal enum class RoomLockTaskMaintenanceExitAction {
    ALREADY_INACTIVE,
    STOP_ACTIVITY_OWNED_LOCK_TASK,
    REMOVE_DEVICE_OWNER_ALLOWLIST,
    BLOCK_SCREEN_PINNING,
    BLOCK_UNKNOWN_STATUS,
    BLOCK_UNOWNED_STRICT_LOCK_TASK
}

internal fun roomLockTaskMaintenanceExitAction(
    status: RoomLockTaskStatus,
    startedByThisActivity: Boolean,
    isDeviceOwner: Boolean
): RoomLockTaskMaintenanceExitAction = when (status) {
    RoomLockTaskStatus.INACTIVE -> RoomLockTaskMaintenanceExitAction.ALREADY_INACTIVE
    RoomLockTaskStatus.SCREEN_PINNING -> RoomLockTaskMaintenanceExitAction.BLOCK_SCREEN_PINNING
    RoomLockTaskStatus.UNKNOWN -> RoomLockTaskMaintenanceExitAction.BLOCK_UNKNOWN_STATUS
    RoomLockTaskStatus.STRICT_LOCKED -> when {
        startedByThisActivity -> RoomLockTaskMaintenanceExitAction.STOP_ACTIVITY_OWNED_LOCK_TASK
        isDeviceOwner -> RoomLockTaskMaintenanceExitAction.REMOVE_DEVICE_OWNER_ALLOWLIST
        else -> RoomLockTaskMaintenanceExitAction.BLOCK_UNOWNED_STRICT_LOCK_TASK
    }
}

internal fun mayLaunchExternalActivityAfterRoomLockTaskExit(status: RoomLockTaskStatus): Boolean =
    status == RoomLockTaskStatus.INACTIVE
