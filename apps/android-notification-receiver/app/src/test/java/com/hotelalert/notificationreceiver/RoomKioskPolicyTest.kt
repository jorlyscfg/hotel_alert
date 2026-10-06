package com.hotelalert.notificationreceiver

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RoomKioskPolicyTest {
    @Test
    fun `immersive mode is limited to configured ROOM sessions outside diagnostics`() {
        assertTrue(shouldUseRoomImmersiveMode(hasRoomSession = true, hasServerOrigin = true, showDiagnostics = false))
        assertFalse(shouldUseRoomImmersiveMode(hasRoomSession = false, hasServerOrigin = true, showDiagnostics = false))
        assertFalse(shouldUseRoomImmersiveMode(hasRoomSession = true, hasServerOrigin = false, showDiagnostics = false))
        assertFalse(shouldUseRoomImmersiveMode(hasRoomSession = true, hasServerOrigin = true, showDiagnostics = true))
        assertFalse(shouldUseRoomImmersiveMode(
            hasRoomSession = true,
            hasServerOrigin = true,
            showDiagnostics = false,
            maintenanceActive = true
        ))
    }

    @Test
    fun `keep screen on is limited to an active focused ROOM session outside maintenance and diagnostics`() {
        assertTrue(
            shouldKeepRoomScreenOn(
                hasRoomSession = true,
                hasServerOrigin = true,
                activityResumed = true,
                windowFocused = true,
                showDiagnostics = false
            )
        )
        assertFalse(shouldKeepRoomScreenOn(
            hasRoomSession = false,
            hasServerOrigin = true,
            activityResumed = true,
            windowFocused = true,
            showDiagnostics = false
        ))
        assertFalse(shouldKeepRoomScreenOn(
            hasRoomSession = true,
            hasServerOrigin = false,
            activityResumed = true,
            windowFocused = true,
            showDiagnostics = false
        ))
        assertFalse(shouldKeepRoomScreenOn(
            hasRoomSession = true,
            hasServerOrigin = true,
            activityResumed = false,
            windowFocused = true,
            showDiagnostics = false
        ))
        assertFalse(shouldKeepRoomScreenOn(
            hasRoomSession = true,
            hasServerOrigin = true,
            activityResumed = true,
            windowFocused = false,
            showDiagnostics = false
        ))
        assertFalse(shouldKeepRoomScreenOn(
            hasRoomSession = true,
            hasServerOrigin = true,
            activityResumed = true,
            windowFocused = true,
            showDiagnostics = true
        ))
        assertFalse(shouldKeepRoomScreenOn(
            hasRoomSession = true,
            hasServerOrigin = true,
            activityResumed = true,
            windowFocused = true,
            showDiagnostics = false,
            maintenanceActive = true
        ))
    }

    @Test
    fun `HOME request requires a ROOM session an available role and no prior request`() {
        assertTrue(shouldRequestHomeRole(29, true, true, false, false))
        assertFalse(shouldRequestHomeRole(28, true, true, false, false))
        assertFalse(shouldRequestHomeRole(29, false, true, false, false))
        assertFalse(shouldRequestHomeRole(29, true, false, false, false))
        assertFalse(shouldRequestHomeRole(29, true, true, true, false))
        assertFalse(shouldRequestHomeRole(29, true, true, false, true))
    }

    @Test
    fun `canceled automatic HOME selection stays one-shot while maintenance can explicitly retry`() {
        val automaticAttemptWasPersistedBeforeOpeningChooser = true
        assertFalse(
            shouldRequestHomeRole(
                apiLevel = 35,
                hasRoomSession = true,
                roleAvailable = true,
                roleHeld = false,
                requestAlreadyAttempted = automaticAttemptWasPersistedBeforeOpeningChooser
            )
        )
        assertEquals(
            HomeSelectionAction.REQUEST_HOME_ROLE,
            chooseHomeSelectionAction(apiLevel = 35, roleAvailable = true, isDeviceOwner = false)
        )
    }

    @Test
    fun `system restoration accepts only boot and package replacement with a ROOM session`() {
        assertTrue(shouldRestoreRoomPresence(ACTION_BOOT_COMPLETED, hasRoomSession = true))
        assertTrue(shouldRestoreRoomPresence(ACTION_MY_PACKAGE_REPLACED, hasRoomSession = true))
        assertFalse(shouldRestoreRoomPresence(ACTION_BOOT_COMPLETED, hasRoomSession = false))
        assertFalse(shouldRestoreRoomPresence(null, hasRoomSession = true))
        assertFalse(shouldRestoreRoomPresence("android.intent.action.OTHER", hasRoomSession = true))
    }

    @Test
    fun `best effort ROOM activity launch is limited to configured ROOM restore events`() {
        assertTrue(shouldAttemptRoomActivityLaunch(ACTION_BOOT_COMPLETED, hasRoomSession = true))
        assertTrue(shouldAttemptRoomActivityLaunch(ACTION_MY_PACKAGE_REPLACED, hasRoomSession = true))
        assertFalse(shouldAttemptRoomActivityLaunch(ACTION_BOOT_COMPLETED, hasRoomSession = false))
        assertFalse(shouldAttemptRoomActivityLaunch(null, hasRoomSession = true))
        assertFalse(shouldAttemptRoomActivityLaunch("android.intent.action.OTHER", hasRoomSession = true))
    }

    @Test
    fun `wake recovery is guarded by room visibility maintenance diagnostics and platform consent`() {
        assertTrue(
            shouldAttemptRoomWakeRecovery(
                apiLevel = 28,
                hasRoomSession = true,
                screenInteractive = true,
                appVisible = false,
                maintenanceActive = false,
                diagnosticsMode = false,
                overlayPermissionGranted = false
            )
        )
        assertTrue(
            shouldAttemptRoomWakeRecovery(
                apiLevel = 29,
                hasRoomSession = true,
                screenInteractive = true,
                appVisible = false,
                maintenanceActive = false,
                diagnosticsMode = false,
                overlayPermissionGranted = true
            )
        )
        assertFalse(shouldWake(apiLevel = 29, overlayPermissionGranted = false))
        assertFalse(shouldWake(hasRoomSession = false))
        assertFalse(shouldWake(screenInteractive = false))
        assertFalse(shouldWake(appVisible = true))
        assertFalse(shouldWake(maintenanceActive = true))
        assertFalse(shouldWake(diagnosticsMode = true))
    }

    @Test
    fun `wake cycle gate permits one attempt per screen wake and invalidates stale attempts`() {
        val gate = RoomWakeCycleGate()

        gate.initializeForCurrentScreenState(screenInteractive = true)
        assertTrue(gate.isCurrentWake(0))
        assertNull(gate.claimScreenOnAttempt())

        gate.onScreenOff()
        val firstWake = gate.claimScreenOnAttempt()
        assertNotNull(firstWake)
        assertTrue(gate.isCurrentWake(firstWake!!))
        assertNull(gate.claimScreenOnAttempt())

        gate.onScreenOff()
        val secondWake = gate.claimScreenOnAttempt()
        assertNotNull(secondWake)
        assertFalse(gate.isCurrentWake(firstWake))
        assertTrue(gate.isCurrentWake(secondWake!!))
    }

    @Test
    fun `wake cycle gate allows the next screen-on when service registers while display is off`() {
        val gate = RoomWakeCycleGate()
        gate.initializeForCurrentScreenState(screenInteractive = false)

        assertNotNull(gate.claimScreenOnAttempt())
        assertNull(gate.claimScreenOnAttempt())
    }

    private fun shouldWake(
        apiLevel: Int = 29,
        hasRoomSession: Boolean = true,
        screenInteractive: Boolean = true,
        appVisible: Boolean = false,
        maintenanceActive: Boolean = false,
        diagnosticsMode: Boolean = false,
        overlayPermissionGranted: Boolean = true
    ): Boolean = shouldAttemptRoomWakeRecovery(
        apiLevel = apiLevel,
        hasRoomSession = hasRoomSession,
        screenInteractive = screenInteractive,
        appVisible = appVisible,
        maintenanceActive = maintenanceActive,
        diagnosticsMode = diagnosticsMode,
        overlayPermissionGranted = overlayPermissionGranted
    )
}
