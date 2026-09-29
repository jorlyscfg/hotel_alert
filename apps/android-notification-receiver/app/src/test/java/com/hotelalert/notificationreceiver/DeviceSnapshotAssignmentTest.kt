package com.hotelalert.notificationreceiver

import com.hotelalert.notificationreceiver.protocol.DeviceSnapshotAssignmentException
import com.hotelalert.notificationreceiver.protocol.DeviceSnapshotParser
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Test

class DeviceSnapshotAssignmentTest {
    @Test
    fun `rejects room assignment with a cleanup code`() {
        val error = assertAssignmentFailure(snapshot(assignmentMode = "ROOM"), "FORBIDDEN_ASSIGNMENT")

        assertEquals("FORBIDDEN_ASSIGNMENT", error.errorCode)
    }

    @Test
    fun `rejects inactive AREA assignment with a cleanup code`() {
        val error = assertAssignmentFailure(snapshot(active = false), "DEVICE_INACTIVE")

        assertEquals("DEVICE_INACTIVE", error.errorCode)
    }

    @Test
    fun `parses authoritative active DND room ids and keeps missing legacy state unknown`() {
        val active = DeviceSnapshotParser.parseSnapshot(
            completeSnapshot().put(
                "activeDoNotDisturbRooms",
                org.json.JSONArray().put(JSONObject().put("id", "room-1").put("doNotDisturb", true))
            ),
            "device-1"
        )
        val legacy = DeviceSnapshotParser.parseSnapshot(completeSnapshot(), "device-1")

        assertEquals(setOf("room-1"), active.activeDoNotDisturbRoomIds)
        assertNull(legacy.activeDoNotDisturbRoomIds)
    }

    private fun assertAssignmentFailure(snapshot: JSONObject, expectedCode: String): DeviceSnapshotAssignmentException {
        try {
            DeviceSnapshotParser.parseSnapshot(snapshot, "device-1")
            fail("Expected an invalid assignment to be rejected.")
        } catch (error: DeviceSnapshotAssignmentException) {
            assertEquals(expectedCode, error.errorCode)
            return error
        }
        throw AssertionError("Expected an invalid assignment to be rejected.")
    }

    private fun snapshot(
        assignmentMode: String = "AREA",
        active: Boolean = true
    ): JSONObject = JSONObject()
        .put(
            "device",
            JSONObject()
                .put("id", "device-1")
                .put("assignmentMode", assignmentMode)
                .put("active", active)
                .put("areaId", "area-1")
        )
        .put("config", JSONObject().put("mode", "AREA"))

    private fun completeSnapshot(): JSONObject = snapshot().apply {
        put("activeRequests", org.json.JSONArray())
        put("snapshotSequence", 1)
        put("currentEventSequence", 1)
        put("deviceConfigVersion", 1)
        put("serverTime", "2026-09-19T00:00:00Z")
        put(
            "config",
            JSONObject()
                .put("mode", "AREA")
                .put("area", JSONObject().put("id", "area-1").put("displayName", "Housekeeping"))
                .put("heartbeatIntervalMs", 1_000)
        )
    }
}
