package com.hotelalert.notificationreceiver

import com.hotelalert.notificationreceiver.protocol.DeviceSessionSnapshot
import com.hotelalert.notificationreceiver.protocol.DeviceSnapshotClient
import com.hotelalert.notificationreceiver.protocol.NativePairingCoordinator
import com.hotelalert.notificationreceiver.protocol.PairingStateRollback
import com.hotelalert.notificationreceiver.protocol.PairingStateStore
import com.hotelalert.notificationreceiver.protocol.ReceiverConfiguration
import com.hotelalert.notificationreceiver.protocol.ReceiverServiceController
import com.hotelalert.notificationreceiver.receiver.NativeReceiverSnapshotStore
import com.hotelalert.notificationreceiver.receiver.ReceiverStatusStore
import com.hotelalert.notificationreceiver.web.HotelAlertWebBridge
import com.hotelalert.notificationreceiver.web.ServerOriginStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class NativeWebViewBridgeTest {
    @Test
    fun `clears the native snapshot when the receiver reports no snapshot`() {
        val snapshotStore = NativeReceiverSnapshotStore()

        snapshotStore.update("{\"snapshotSequence\":1}")
        snapshotStore.update(null)

        assertEquals(null, snapshotStore.read())
    }

    @Test
    fun `exposes pairing and snapshot capabilities without credentials`() = runTest {
        val capabilities = JSONObject(createBridge(this).getCapabilities())

        assertTrue(capabilities.getBoolean("pairing"))
        assertTrue(capabilities.getBoolean("snapshot"))
        assertFalse(capabilities.has("deviceToken"))
        assertFalse(capabilities.has("deviceId"))
    }

    @Test
    fun `accepts pairing asynchronously and publishes the native snapshot`() = runTest {
        val snapshotStore = NativeReceiverSnapshotStore()
        val bridge = createBridge(this, snapshotStore)

        val accepted = JSONObject(bridge.pairDevice("{\"deviceId\":\"device-1\",\"deviceToken\":\"token-1\"}"))
        val requestId = accepted.getString("requestId")

        assertTrue(accepted.getBoolean("accepted"))

        advanceUntilIdle()

        val status = JSONObject(bridge.getPairingStatus(requestId))
        assertEquals("SUCCEEDED", status.getString("state"))
        assertEquals("device-1", status.getString("deviceId"))
        assertEquals("{\"snapshotSequence\":1}", snapshotStore.read())
    }

    @Test
    fun `rejects malformed pairing input without launching native work`() = runTest {
        val bridge = createBridge(this)

        val accepted = JSONObject(bridge.pairDevice("{}"))
        advanceUntilIdle()

        assertEquals(
            "INVALID_PAIRING_REQUEST",
            JSONObject(bridge.getPairingStatus(accepted.getString("requestId"))).getString("errorCode")
        )
    }

    private fun createBridge(
        scope: CoroutineScope,
        snapshotStore: NativeReceiverSnapshotStore = NativeReceiverSnapshotStore()
    ): HotelAlertWebBridge {
        val stateStore = FakePairingStateStore()
        val coordinator = NativePairingCoordinator(
            serverOriginStore = FixedOriginStore(),
            snapshotClient = FixedSnapshotClient(),
            stateStore = stateStore,
            serviceController = NoopServiceController(),
            clientInstanceIdFactory = { "client-1" },
            clientVersion = "0.1.0",
            onSnapshot = snapshotStore::update
        )
        return HotelAlertWebBridge(scope, coordinator, snapshotStore, ReceiverStatusStore())
    }

    private class FixedOriginStore : ServerOriginStore {
        override fun read(): String = "https://hotel.test"

        override fun write(serverOrigin: String) = Unit
    }

    private class FixedSnapshotClient : DeviceSnapshotClient {
        override suspend fun fetch(serverOrigin: String, deviceId: String, token: String) = DeviceSessionSnapshot(
            deviceId = deviceId,
            areaId = "area-1",
            areaDisplayName = "Housekeeping",
            currentEventSequence = 1,
            deviceConfigVersion = 1,
            heartbeatIntervalMs = 15_000,
            payloadJson = "{\"snapshotSequence\":1}"
        )
    }

    private class FakePairingStateStore : PairingStateStore {
        override fun readConfiguration(): ReceiverConfiguration? = null

        override suspend fun replace(configuration: ReceiverConfiguration, token: String): PairingStateRollback = PairingStateRollback { }
    }

    private class NoopServiceController : ReceiverServiceController {
        override fun restart() = Unit
    }
}
