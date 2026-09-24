package com.hotelalert.notificationreceiver

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RoomKioskPolicyTest {
    @Test
    fun `immersive mode is limited to configured ROOM sessions outside diagnostics`() {
        assertTrue(shouldUseRoomImmersiveMode(hasRoomSession = true, hasServerOrigin = true, showDiagnostics = false))
        assertFalse(shouldUseRoomImmersiveMode(hasRoomSession = false, hasServerOrigin = true, showDiagnostics = false))
        assertFalse(shouldUseRoomImmersiveMode(hasRoomSession = true, hasServerOrigin = false, showDiagnostics = false))
        assertFalse(shouldUseRoomImmersiveMode(hasRoomSession = true, hasServerOrigin = true, showDiagnostics = true))
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
    fun `system restoration accepts only boot and package replacement with a ROOM session`() {
        assertTrue(shouldRestoreRoomPresence(ACTION_BOOT_COMPLETED, hasRoomSession = true))
        assertTrue(shouldRestoreRoomPresence(ACTION_MY_PACKAGE_REPLACED, hasRoomSession = true))
        assertFalse(shouldRestoreRoomPresence(ACTION_BOOT_COMPLETED, hasRoomSession = false))
        assertFalse(shouldRestoreRoomPresence(null, hasRoomSession = true))
        assertFalse(shouldRestoreRoomPresence("android.intent.action.OTHER", hasRoomSession = true))
    }
}
