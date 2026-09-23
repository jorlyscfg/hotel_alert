package com.hotelalert.notificationreceiver

import com.hotelalert.notificationreceiver.protocol.ReceiverConfiguration
import com.hotelalert.notificationreceiver.protocol.ReceiverConfigurationStore
import com.hotelalert.notificationreceiver.receiver.AreaSnapshotCacheCodec
import com.hotelalert.notificationreceiver.receiver.AreaSnapshotPersistence
import com.hotelalert.notificationreceiver.receiver.NativeReceiverSnapshotStore
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeReceiverSnapshotStoreTest {
    @Test
    fun `restores the last validated snapshot after store recreation`() {
        val cache = MemoryAreaSnapshotPersistence()
        val assignment = MutableConfigurationStore(configuration("device-1"))
        val firstStore = NativeReceiverSnapshotStore(assignment, cache)

        firstStore.update(snapshot("device-1"))
        val restoredStore = NativeReceiverSnapshotStore(assignment, cache)

        assertEquals(JSONObject(snapshot("device-1")).toString(), restoredStore.read())
    }

    @Test
    fun `does not restore a snapshot belonging to another device`() {
        val cache = MemoryAreaSnapshotPersistence().also { it.write("device-1", snapshot("device-1")) }

        val store = NativeReceiverSnapshotStore(MutableConfigurationStore(configuration("device-2")), cache)

        assertNull(store.read())
        assertTrue(cache.isEmpty())
    }

    @Test
    fun `rejects a payload whose device id differs from its cache envelope`() {
        val cache = MemoryAreaSnapshotPersistence().also { it.write("device-1", snapshot("device-2")) }

        val store = NativeReceiverSnapshotStore(MutableConfigurationStore(configuration("device-1")), cache)

        assertNull(store.read())
        assertTrue(cache.isEmpty())
    }

    @Test
    fun `clears the durable snapshot when assignment is missing`() {
        val cache = MemoryAreaSnapshotPersistence().also { it.write("device-1", snapshot("device-1")) }

        val store = NativeReceiverSnapshotStore(MutableConfigurationStore(null), cache)

        assertNull(store.read())
        assertTrue(cache.isEmpty())
    }

    @Test
    fun `clears malformed snapshots instead of restoring them`() {
        assertInvalidSnapshotIsCleared("not-json")
    }

    @Test
    fun `clears inactive AREA snapshots instead of restoring them`() {
        val inactiveSnapshot = snapshot("device-1").replace("\"active\":true", "\"active\":false")

        assertInvalidSnapshotIsCleared(inactiveSnapshot)
    }

    @Test
    fun `clears non AREA snapshots instead of restoring them`() {
        val nonAreaSnapshot = snapshot("device-1")
            .replace("\"assignmentMode\":\"AREA\"", "\"assignmentMode\":\"ROOM\"")

        assertInvalidSnapshotIsCleared(nonAreaSnapshot)
    }

    @Test
    fun `null snapshot clears current and durable state`() {
        val cache = MemoryAreaSnapshotPersistence()
        val store = NativeReceiverSnapshotStore(MutableConfigurationStore(configuration("device-1")), cache)
        store.update(snapshot("device-1"))

        store.update(null)

        assertNull(store.read())
        assertTrue(cache.isEmpty())
    }

    @Test
    fun `snapshot cache envelope rejects a different device id`() {
        val encoded = AreaSnapshotCacheCodec.encode("device-1", snapshot("device-1"))

        assertNull(AreaSnapshotCacheCodec.decode(encoded, "device-2"))
    }

    private fun assertInvalidSnapshotIsCleared(rawSnapshot: String) {
        val cache = MemoryAreaSnapshotPersistence().also { it.write("device-1", rawSnapshot) }

        val store = NativeReceiverSnapshotStore(MutableConfigurationStore(configuration("device-1")), cache)

        assertNull(store.read())
        assertTrue(cache.isEmpty())
    }

    private fun configuration(deviceId: String) = ReceiverConfiguration(
        serverOrigin = "https://hotel.test",
        deviceId = deviceId,
        clientInstanceId = "client-1",
        clientVersion = "0.1.0"
    )

    private fun snapshot(deviceId: String): String = """
        {
          "device":{"id":"$deviceId","assignmentMode":"AREA","active":true,"areaId":"area-1"},
          "config":{"mode":"AREA","area":{"id":"area-1","displayName":"Housekeeping"},"heartbeatIntervalMs":15000},
          "activeRequests":[],
          "snapshotSequence":1,
          "currentEventSequence":1,
          "deviceConfigVersion":1,
          "serverTime":"2026-09-22T18:00:00.000Z"
        }
    """.trimIndent()

    private class MutableConfigurationStore(
        var configuration: ReceiverConfiguration?
    ) : ReceiverConfigurationStore {
        override fun read(): ReceiverConfiguration? = configuration

        override fun write(configuration: ReceiverConfiguration) {
            this.configuration = configuration
        }
    }

    private class MemoryAreaSnapshotPersistence : AreaSnapshotPersistence {
        private var deviceId: String? = null
        private var snapshotJson: String? = null

        override fun read(expectedDeviceId: String): String? {
            if (deviceId != expectedDeviceId) {
                clear()
                return null
            }
            return snapshotJson
        }

        override fun write(deviceId: String, snapshotJson: String) {
            this.deviceId = deviceId
            this.snapshotJson = snapshotJson
        }

        override fun clear() {
            deviceId = null
            snapshotJson = null
        }

        fun isEmpty(): Boolean = deviceId == null && snapshotJson == null
    }
}
