package com.hotelalert.notificationreceiver

import com.hotelalert.notificationreceiver.ui.roomScreensaverButtonEventScript
import com.hotelalert.notificationreceiver.protocol.DeviceSessionSnapshot
import com.hotelalert.notificationreceiver.protocol.DeviceSnapshotClient
import com.hotelalert.notificationreceiver.protocol.NativePairingCoordinator
import com.hotelalert.notificationreceiver.protocol.NativeRequestCommandClient
import com.hotelalert.notificationreceiver.protocol.NativeRequestCommandCoordinator
import com.hotelalert.notificationreceiver.protocol.NativeRequestCommandException
import com.hotelalert.notificationreceiver.protocol.NativeRequestTransition
import com.hotelalert.notificationreceiver.protocol.PairingStateRollback
import com.hotelalert.notificationreceiver.protocol.PairingStateStore
import com.hotelalert.notificationreceiver.protocol.ReceiverConfiguration
import com.hotelalert.notificationreceiver.protocol.ReceiverConfigurationStore
import com.hotelalert.notificationreceiver.protocol.ReceiverServiceController
import com.hotelalert.notificationreceiver.receiver.NativeReceiverSnapshotStore
import com.hotelalert.notificationreceiver.receiver.ReceiverStatusStore
import com.hotelalert.notificationreceiver.storage.DeviceTokenStore
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

    @Test
    fun `forwards saver phase changes and clears the active state when the web view is released`() = runTest {
        val bridge = createBridge(this)
        val owner = Any()
        val states = mutableListOf<Boolean>()
        bridge.bindRoomScreensaverStateListener(owner, states::add)

        assertTrue(bridge.setRoomScreensaverActive(true))
        bridge.clearRoomScreensaverState()

        assertEquals(listOf(true, false), states)
        bridge.unbindRoomScreensaverStateListener(owner)
        assertFalse(bridge.setRoomScreensaverActive(true))
    }

    @Test
    fun `routes left-button DND through the active WebView listener without delivering blackout twice`() = runTest {
        val bridge = createBridge(this)
        val owner = Any()
        val received = mutableListOf<RoomScreensaverButtonAction>()
        bridge.bindRoomScreensaverButtonListener(owner, received::add)

        assertTrue(bridge.dispatchRoomScreensaverButton(RoomScreensaverButtonAction.TOGGLE_DO_NOT_DISTURB))
        assertFalse(bridge.dispatchRoomScreensaverButton(RoomScreensaverButtonAction.TOGGLE_DISPLAY_BLACKOUT))
        bridge.unbindRoomScreensaverButtonListener(Any())
        assertTrue(bridge.dispatchRoomScreensaverButton(RoomScreensaverButtonAction.TOGGLE_DO_NOT_DISTURB))
        bridge.unbindRoomScreensaverButtonListener(owner)

        assertEquals(
            listOf(RoomScreensaverButtonAction.TOGGLE_DO_NOT_DISTURB, RoomScreensaverButtonAction.TOGGLE_DO_NOT_DISTURB),
            received
        )
        assertFalse(bridge.dispatchRoomScreensaverButton(RoomScreensaverButtonAction.TOGGLE_DO_NOT_DISTURB))
        assertEquals(
            "window.dispatchEvent(new CustomEvent('hotel-alert-room-screensaver-button', {detail: 'TOGGLE_DO_NOT_DISTURB', bubbles: false}));",
            roomScreensaverButtonEventScript(RoomScreensaverButtonAction.TOGGLE_DO_NOT_DISTURB)
        )
    }

    @Test
    fun `exposes server request id separately from the native command request id`() = runTest {
        val snapshotStore = NativeReceiverSnapshotStore().also { it.update("{\"config\":{\"mode\":\"AREA\"}}") }
        val commandCoordinator = NativeRequestCommandCoordinator(
            configurationStore = object : ReceiverConfigurationStore {
                override fun read() = ReceiverConfiguration("https://hotel.test", "device-1", "client-1", "0.1.0")
                override fun write(configuration: ReceiverConfiguration) = Unit
            },
            tokenStore = object : DeviceTokenStore {
                override suspend fun read() = "device-token"
                override suspend fun write(token: String) = Unit
                override suspend fun clear() = Unit
            },
            snapshotStore = snapshotStore,
            client = object : NativeRequestCommandClient {
                override suspend fun transition(serverOrigin: String, deviceId: String, token: String, request: NativeRequestTransition): String {
                    throw NativeRequestCommandException(500, "INTERNAL_ERROR", "server-request-12345678")
                }
            }
        )
        val bridge = createBridge(this, snapshotStore, commandCoordinator)
        val accepted = JSONObject(bridge.transitionRequest(
            """{"requestId":"request-1","targetStatus":"IN_PROGRESS","expectedVersion":2,"idempotencyKey":"transition-1","responsibleName":"Taylor Morgan"}"""
        ))
        advanceUntilIdle()

        val status = JSONObject(bridge.getCommandStatus(accepted.getString("requestId")))
        assertEquals(accepted.getString("requestId"), status.getString("requestId"))
        assertEquals("FAILED", status.getString("state"))
        assertEquals("INTERNAL_ERROR", status.getString("errorCode"))
        assertEquals("server-request-12345678", status.getString("serverRequestId"))
        assertFalse(status.has("responsibleName"))
    }

    private fun createBridge(
        scope: CoroutineScope,
        snapshotStore: NativeReceiverSnapshotStore = NativeReceiverSnapshotStore(),
        commandCoordinator: NativeRequestCommandCoordinator? = null
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
        return HotelAlertWebBridge(scope, coordinator, snapshotStore, ReceiverStatusStore(), commandCoordinator)
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
