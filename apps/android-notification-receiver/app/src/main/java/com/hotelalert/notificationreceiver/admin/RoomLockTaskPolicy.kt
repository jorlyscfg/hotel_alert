package com.hotelalert.notificationreceiver.admin

internal const val MIN_ROOM_LOCK_TASK_API_LEVEL = 26

internal fun shouldConfigureRoomLockTask(
    apiLevel: Int,
    hasRoomSession: Boolean,
    isDeviceOwner: Boolean
): Boolean = apiLevel >= MIN_ROOM_LOCK_TASK_API_LEVEL && hasRoomSession && isDeviceOwner

internal fun shouldEnterStrictRoomLockTask(
    hasRoomSession: Boolean,
    isDeviceOwner: Boolean,
    packageAllowlisted: Boolean,
    strictModeRequested: Boolean,
    maintenanceExitAvailable: Boolean
): Boolean = hasRoomSession &&
    isDeviceOwner &&
    packageAllowlisted &&
    strictModeRequested &&
    maintenanceExitAvailable

internal enum class RoomLockTaskPreparation {
    ANDROID_VERSION_UNSUPPORTED,
    ROOM_SESSION_REQUIRED,
    DEVICE_OWNER_REQUIRED,
    PACKAGE_NOT_ALLOWLISTED,
    POLICY_READY,
    POLICY_REJECTED
}

internal interface RoomLockTaskDevicePolicy {
    fun isDeviceOwner(packageName: String): Boolean

    fun setLockTaskPackages(packages: Set<String>)

    fun isLockTaskPermitted(packageName: String): Boolean
}

internal class RoomLockTaskController(
    private val packageName: String,
    private val apiLevel: Int,
    private val devicePolicy: RoomLockTaskDevicePolicy
) {
    fun prepareForRoomSession(hasRoomSession: Boolean): RoomLockTaskPreparation {
        if (apiLevel < MIN_ROOM_LOCK_TASK_API_LEVEL) {
            return RoomLockTaskPreparation.ANDROID_VERSION_UNSUPPORTED
        }
        if (!hasRoomSession) return RoomLockTaskPreparation.ROOM_SESSION_REQUIRED

        return try {
            val isDeviceOwner = devicePolicy.isDeviceOwner(packageName)
            if (!shouldConfigureRoomLockTask(apiLevel, hasRoomSession, isDeviceOwner)) {
                return RoomLockTaskPreparation.DEVICE_OWNER_REQUIRED
            }

            devicePolicy.setLockTaskPackages(setOf(packageName))
            if (devicePolicy.isLockTaskPermitted(packageName)) {
                RoomLockTaskPreparation.POLICY_READY
            } else {
                RoomLockTaskPreparation.PACKAGE_NOT_ALLOWLISTED
            }
        } catch (_: SecurityException) {
            RoomLockTaskPreparation.POLICY_REJECTED
        }
    }

    fun isStrictModeReady(
        hasRoomSession: Boolean,
        strictModeRequested: Boolean,
        maintenanceExitAvailable: Boolean
    ): Boolean {
        if (apiLevel < MIN_ROOM_LOCK_TASK_API_LEVEL ||
            !hasRoomSession ||
            !strictModeRequested ||
            !maintenanceExitAvailable
        ) return false
        return try {
            shouldEnterStrictRoomLockTask(
                hasRoomSession = hasRoomSession,
                isDeviceOwner = devicePolicy.isDeviceOwner(packageName),
                packageAllowlisted = devicePolicy.isLockTaskPermitted(packageName),
                strictModeRequested = strictModeRequested,
                maintenanceExitAvailable = maintenanceExitAvailable
            )
        } catch (_: SecurityException) {
            false
        }
    }
}
