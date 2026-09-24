package com.hotelalert.notificationreceiver.admin

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.Build

internal class AndroidRoomLockTaskDevicePolicy(context: Context) : RoomLockTaskDevicePolicy {
    private val appContext = context.applicationContext
    private val devicePolicyManager = requireNotNull(
        appContext.getSystemService(DevicePolicyManager::class.java)
    ) { "DevicePolicyManager is unavailable." }
    private val adminComponent = ComponentName(appContext, HotelAlertDeviceAdminReceiver::class.java)

    private val controller = RoomLockTaskController(
        packageName = appContext.packageName,
        apiLevel = Build.VERSION.SDK_INT,
        devicePolicy = this
    )

    fun prepareForRoomSession(hasRoomSession: Boolean): RoomLockTaskPreparation =
        controller.prepareForRoomSession(hasRoomSession)

    fun isStrictModeReady(
        hasRoomSession: Boolean,
        strictModeRequested: Boolean,
        maintenanceExitAvailable: Boolean
    ): Boolean = controller.isStrictModeReady(
        hasRoomSession = hasRoomSession,
        strictModeRequested = strictModeRequested,
        maintenanceExitAvailable = maintenanceExitAvailable
    )

    fun isDeviceOwner(): Boolean = devicePolicyManager.isDeviceOwnerApp(appContext.packageName)

    /** Removes only this app from the existing allowlist; Android exits its strict Lock Task. */
    fun removeAppFromLockTaskAllowlistForMaintenance(): Boolean {
        if (!isDeviceOwner()) return false
        return try {
            val remainingPackages = devicePolicyManager.getLockTaskPackages(adminComponent)
                .filterNot { it == appContext.packageName }
            devicePolicyManager.setLockTaskPackages(adminComponent, remainingPackages.toTypedArray())
            !devicePolicyManager.isLockTaskPermitted(appContext.packageName)
        } catch (_: SecurityException) {
            false
        }
    }

    override fun isDeviceOwner(packageName: String): Boolean =
        devicePolicyManager.isDeviceOwnerApp(packageName)

    override fun setLockTaskPackages(packages: Set<String>) {
        devicePolicyManager.setLockTaskPackages(adminComponent, packages.toTypedArray())
    }

    override fun isLockTaskPermitted(packageName: String): Boolean =
        devicePolicyManager.isLockTaskPermitted(packageName)
}
