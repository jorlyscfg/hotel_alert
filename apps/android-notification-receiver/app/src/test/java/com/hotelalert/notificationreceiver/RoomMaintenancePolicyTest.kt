package com.hotelalert.notificationreceiver

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RoomMaintenancePolicyTest {
    @Test
    fun `opens the PIN gate on four taps spaced at the 500 ms limit`() {
        val gate = RoomMaintenanceTapGate()

        assertFalse(gate.onTap(hasRoomSession = true, maintenanceOpen = false, nowMillis = 0L))
        assertFalse(gate.onTap(hasRoomSession = true, maintenanceOpen = false, nowMillis = 500L))
        assertFalse(gate.onTap(hasRoomSession = true, maintenanceOpen = false, nowMillis = 1_000L))
        assertTrue(gate.onTap(hasRoomSession = true, maintenanceOpen = false, nowMillis = 1_500L))
    }

    @Test
    fun `does not open gate outside ROOM and resets an interrupted sequence`() {
        val gate = RoomMaintenanceTapGate()
        gate.onTap(hasRoomSession = true, maintenanceOpen = false, nowMillis = 0L)
        gate.onTap(hasRoomSession = true, maintenanceOpen = false, nowMillis = 100L)

        assertFalse(gate.onTap(hasRoomSession = false, maintenanceOpen = false, nowMillis = 150L))
        assertFalse(gate.onTap(hasRoomSession = true, maintenanceOpen = false, nowMillis = 200L))
        assertFalse(gate.onTap(hasRoomSession = true, maintenanceOpen = true, nowMillis = 300L))
        assertFalse(gate.onTap(hasRoomSession = true, maintenanceOpen = false, nowMillis = 400L))
    }

    @Test
    fun `a 501 ms pause resets the sequence`() {
        val gate = RoomMaintenanceTapGate()
        gate.onTap(hasRoomSession = true, maintenanceOpen = false, nowMillis = 1_000L)
        gate.onTap(hasRoomSession = true, maintenanceOpen = false, nowMillis = 1_100L)
        gate.onTap(hasRoomSession = true, maintenanceOpen = false, nowMillis = 1_200L)

        assertFalse(gate.onTap(hasRoomSession = true, maintenanceOpen = false, nowMillis = 1_701L))
        assertFalse(gate.onTap(hasRoomSession = true, maintenanceOpen = false, nowMillis = 2_201L))
        assertFalse(gate.onTap(hasRoomSession = true, maintenanceOpen = false, nowMillis = 2_701L))
        assertTrue(gate.onTap(hasRoomSession = true, maintenanceOpen = false, nowMillis = 3_201L))
    }
}
