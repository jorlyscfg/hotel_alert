package com.hotelalert.notificationreceiver.admin

import android.app.admin.DevicePolicyManager
import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import com.hotelalert.notificationreceiver.RoomHomeStatus
import com.hotelalert.notificationreceiver.MainActivity
import com.hotelalert.notificationreceiver.resolveRoomHomeStatus
import com.hotelalert.notificationreceiver.shouldClearPersistentPreferredHome
import com.hotelalert.notificationreceiver.shouldSetPersistentPreferredHome

internal data class RoomHomePolicyStatus(
    val homeStatus: RoomHomeStatus,
    val isDeviceOwner: Boolean,
    val roleAvailable: Boolean
)

internal class AndroidRoomHomePolicy(context: Context) {
    private val appContext = context.applicationContext
    private val packageName = appContext.packageName
    private val devicePolicyManager = requireNotNull(
        appContext.getSystemService(DevicePolicyManager::class.java)
    ) { "DevicePolicyManager is unavailable." }
    private val adminComponent = ComponentName(appContext, HotelAlertDeviceAdminReceiver::class.java)
    private val homeActivity = ComponentName(appContext, MainActivity::class.java)

    fun readStatus(): RoomHomePolicyStatus {
        val (roleAvailable, roleHeld) = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val roleManager = appContext.getSystemService(RoleManager::class.java)
            val available = roleManager?.isRoleAvailable(RoleManager.ROLE_HOME) == true
            available to (available && roleManager?.isRoleHeld(RoleManager.ROLE_HOME) == true)
        } else {
            false to false
        }
        val resolvedHomePackage = resolveHomePackage()
        return RoomHomePolicyStatus(
            homeStatus = resolveRoomHomeStatus(
                apiLevel = Build.VERSION.SDK_INT,
                roleAvailable = roleAvailable,
                roleHeldByHotelAlert = roleHeld,
                resolvedHomePackage = resolvedHomePackage,
                hotelAlertPackage = packageName
            ),
            isDeviceOwner = devicePolicyManager.isDeviceOwnerApp(packageName),
            roleAvailable = roleAvailable
        )
    }

    /** Set a persistent HOME handler only after Android confirms this app is Device Owner. */
    fun setPersistentPreferredHome(): Boolean {
        if (!shouldSetPersistentPreferredHome(devicePolicyManager.isDeviceOwnerApp(packageName))) return false
        return try {
            devicePolicyManager.addPersistentPreferredActivity(
                adminComponent,
                IntentFilter(Intent.ACTION_MAIN).apply {
                    addCategory(Intent.CATEGORY_HOME)
                    addCategory(Intent.CATEGORY_DEFAULT)
                },
                homeActivity
            )
            readStatus().homeStatus == RoomHomeStatus.HOTEL_ALERT_DEFAULT
        } catch (_: SecurityException) {
            false
        }
    }

    /** Removes only this package's persistent preferred-activity rules, and only as Device Owner. */
    fun clearPersistentPreferredHome(): Boolean {
        if (!shouldClearPersistentPreferredHome(devicePolicyManager.isDeviceOwnerApp(packageName))) return false
        return try {
            devicePolicyManager.clearPackagePersistentPreferredActivities(adminComponent, packageName)
            true
        } catch (_: SecurityException) {
            false
        }
    }

    private fun resolveHomePackage(): String? {
        val homeIntent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            addCategory(Intent.CATEGORY_DEFAULT)
        }
        val resolved = appContext.packageManager.resolveActivity(homeIntent, PackageManager.MATCH_DEFAULT_ONLY)
        return resolved?.activityInfo?.packageName
    }
}
