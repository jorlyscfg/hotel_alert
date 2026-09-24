package com.hotelalert.notificationreceiver.admin

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RoomLockTaskPolicyTest {
    @Test
    fun `lock task policy configuration requires supported Android ROOM session and Device Owner`() {
        assertTrue(shouldConfigureRoomLockTask(26, hasRoomSession = true, isDeviceOwner = true))
        assertFalse(shouldConfigureRoomLockTask(25, hasRoomSession = true, isDeviceOwner = true))
        assertFalse(shouldConfigureRoomLockTask(35, hasRoomSession = false, isDeviceOwner = true))
        assertFalse(shouldConfigureRoomLockTask(35, hasRoomSession = true, isDeviceOwner = false))
    }

    @Test
    fun `strict mode requires opt in and a local maintenance exit`() {
        assertTrue(
            shouldEnterStrictRoomLockTask(
                hasRoomSession = true,
                isDeviceOwner = true,
                packageAllowlisted = true,
                strictModeRequested = true,
                maintenanceExitAvailable = true
            )
        )
        assertFalse(
            shouldEnterStrictRoomLockTask(
                hasRoomSession = true,
                isDeviceOwner = true,
                packageAllowlisted = true,
                strictModeRequested = true,
                maintenanceExitAvailable = false
            )
        )
        assertFalse(
            shouldEnterStrictRoomLockTask(
                hasRoomSession = true,
                isDeviceOwner = true,
                packageAllowlisted = true,
                strictModeRequested = false,
                maintenanceExitAvailable = true
            )
        )
    }

    @Test
    fun `AREA or Admin sessions cannot enter strict ROOM mode`() {
        assertFalse(
            shouldEnterStrictRoomLockTask(
                hasRoomSession = false,
                isDeviceOwner = true,
                packageAllowlisted = true,
                strictModeRequested = true,
                maintenanceExitAvailable = true
            )
        )
    }
}
