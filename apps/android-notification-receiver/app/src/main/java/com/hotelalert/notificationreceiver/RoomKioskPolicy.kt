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

internal const val ACTION_BOOT_COMPLETED = "android.intent.action.BOOT_COMPLETED"
internal const val ACTION_MY_PACKAGE_REPLACED = "android.intent.action.MY_PACKAGE_REPLACED"

private val ROOM_PRESENCE_RESTORE_ACTIONS = setOf(
    ACTION_BOOT_COMPLETED,
    ACTION_MY_PACKAGE_REPLACED
)
