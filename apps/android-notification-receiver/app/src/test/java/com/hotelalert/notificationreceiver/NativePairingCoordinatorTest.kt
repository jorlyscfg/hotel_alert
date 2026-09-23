package com.hotelalert.notificationreceiver

import com.hotelalert.notificationreceiver.protocol.DeviceSessionSnapshot
import com.hotelalert.notificationreceiver.protocol.DeviceSnapshotClient
import com.hotelalert.notificationreceiver.protocol.DeviceSnapshotException
import com.hotelalert.notificationreceiver.protocol.NativePairingCoordinator
import com.hotelalert.notificationreceiver.protocol.NativePairingRequest
import com.hotelalert.notificationreceiver.protocol.NativePairingResult
import com.hotelalert.notificationreceiver.protocol.PairingStateRollback
import com.hotelalert.notificationreceiver.protocol.ReceiverConfiguration
import com.hotelalert.notificationreceiver.protocol.PairingStateStore
import com.hotelalert.notificationreceiver.protocol.ReceiverServiceController
import com.hotelalert.notificationreceiver.web.ServerOriginStore
import org.junit.Assert.assertThrows
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class NativePairingCoordinatorTest {
    @Test
    fun `pairs an active AREA device and restarts the native receiver`() = runTest {
        val stateStore = FakePairingStateStore()
        val serviceController = RecordingServiceController()
        val coordinator = NativePairingCoordinator(
            serverOriginStore = FixedOriginStore("https://hotel.test"),
            snapshotClient = FixedSnapshotClient(),
            stateStore = stateStore,
            serviceController = serviceController,
            clientInstanceIdFactory = { "client-1" },
            clientVersion = "0.1.0"
        )

        val result = coordinator.pair(NativePairingRequest("device-1", "device-token"))

        assertTrue(result is NativePairingResult.Success)
        assertEquals(
            ReceiverConfiguration("https://hotel.test", "device-1", "client-1", "0.1.0"),
            stateStore.configuration
        )
        assertEquals("device-token", stateStore.token)
        assertEquals(1, serviceController.restartCalls)
    }

    @Test
    fun `rejects malformed pairing requests before contacting the server`() {
        assertThrows(IllegalArgumentException::class.java) {
            NativePairingRequest.parse("{\"deviceId\":\"\",\"deviceToken\":\"token\"}")
        }
        assertThrows(IllegalArgumentException::class.java) {
            NativePairingRequest.parse("{\"deviceId\":\"device-1\",\"deviceToken\":\"token\\n\"}")
        }
    }

    @Test
    fun `does not persist an expired token or start the receiver`() = runTest {
        val stateStore = FakePairingStateStore()
        val serviceController = RecordingServiceController()
        val coordinator = NativePairingCoordinator(
            serverOriginStore = FixedOriginStore("https://hotel.test"),
            snapshotClient = FailingSnapshotClient(DeviceSnapshotException(401, "TOKEN_INVALID")),
            stateStore = stateStore,
            serviceController = serviceController,
            clientInstanceIdFactory = { "client-1" },
            clientVersion = "0.1.0"
        )

        val result = coordinator.pair(NativePairingRequest("device-1", "expired-token"))

        assertEquals(NativePairingResult.Failure("TOKEN_INVALID"), result)
        assertEquals(null, stateStore.configuration)
        assertEquals(null, stateStore.token)
        assertEquals(0, serviceController.restartCalls)
    }

    @Test
    fun `rejects a non AREA assignment without replacing an existing pairing`() = runTest {
        val stateStore = FakePairingStateStore().apply {
            configuration = ReceiverConfiguration("https://hotel.test", "device-old", "client-existing", "0.1.0")
            token = "old-token"
        }
        val serviceController = RecordingServiceController()
        val coordinator = NativePairingCoordinator(
            serverOriginStore = FixedOriginStore("https://hotel.test"),
            snapshotClient = FailingSnapshotClient(IllegalArgumentException("The device must have an active AREA assignment.")),
            stateStore = stateStore,
            serviceController = serviceController,
            clientInstanceIdFactory = { "client-new" },
            clientVersion = "0.1.0"
        )

        val result = coordinator.pair(NativePairingRequest("device-new", "new-token"))

        assertEquals(NativePairingResult.Failure("INVALID_ASSIGNMENT"), result)
        assertEquals("device-old", stateStore.configuration?.deviceId)
        assertEquals("old-token", stateStore.token)
        assertEquals(0, serviceController.restartCalls)
    }

    @Test
    fun `retains the stable client instance when replacing a pairing`() = runTest {
        val stateStore = FakePairingStateStore().apply {
            configuration = ReceiverConfiguration("https://hotel.test", "device-old", "client-existing", "0.1.0")
        }
        val coordinator = NativePairingCoordinator(
            serverOriginStore = FixedOriginStore("https://hotel.test"),
            snapshotClient = FixedSnapshotClient(),
            stateStore = stateStore,
            serviceController = RecordingServiceController(),
            clientInstanceIdFactory = { "client-new" },
            clientVersion = "0.1.0"
        )

        coordinator.pair(NativePairingRequest("device-new", "new-token"))

        assertEquals("client-existing", stateStore.configuration?.clientInstanceId)
    }

    @Test
    fun `does not start the receiver when pairing persistence fails`() = runTest {
        val stateStore = FakePairingStateStore().apply { failReplace = true }
        val serviceController = RecordingServiceController()
        val coordinator = NativePairingCoordinator(
            serverOriginStore = FixedOriginStore("https://hotel.test"),
            snapshotClient = FixedSnapshotClient(),
            stateStore = stateStore,
            serviceController = serviceController,
            clientInstanceIdFactory = { "client-1" },
            clientVersion = "0.1.0"
        )

        val result = coordinator.pair(NativePairingRequest("device-1", "device-token"))

        assertEquals(NativePairingResult.Failure("PAIRING_START_FAILED"), result)
        assertEquals(0, serviceController.restartCalls)
    }

    @Test
    fun `restores the previous pairing when restart fails so a retry does not use partial state`() = runTest {
        val stateStore = FakePairingStateStore().apply {
            configuration = ReceiverConfiguration("https://hotel.test", "device-old", "client-existing", "0.1.0")
            token = "old-token"
        }
        val serviceController = FailingThenSuccessfulServiceController()
        var snapshotPayload = "{\"snapshotSequence\":0}"
        val coordinator = NativePairingCoordinator(
            serverOriginStore = FixedOriginStore("https://hotel.test"),
            snapshotClient = FixedSnapshotClient(),
            stateStore = stateStore,
            serviceController = serviceController,
            clientInstanceIdFactory = { "client-new" },
            clientVersion = "0.1.0",
            onSnapshot = { snapshotPayload = it }
        )

        val firstResult = coordinator.pair(NativePairingRequest("device-new", "new-token"))

        assertEquals(NativePairingResult.Failure("PAIRING_START_FAILED"), firstResult)
        assertEquals("device-old", stateStore.configuration?.deviceId)
        assertEquals("old-token", stateStore.token)
        assertEquals("{\"snapshotSequence\":0}", snapshotPayload)

        val retryResult = coordinator.pair(NativePairingRequest("device-new", "new-token"))

        assertTrue(retryResult is NativePairingResult.Success)
        assertEquals("device-new", stateStore.configuration?.deviceId)
        assertEquals("new-token", stateStore.token)
        assertEquals(2, serviceController.restartCalls)
    }

    private class FixedOriginStore(private val origin: String?) : ServerOriginStore {
        override fun read(): String? = origin

        override fun write(serverOrigin: String) = Unit
    }

    private class FixedSnapshotClient : DeviceSnapshotClient {
        override suspend fun fetch(serverOrigin: String, deviceId: String, token: String) = DeviceSessionSnapshot(
            deviceId = deviceId,
            areaId = "area-1",
            areaDisplayName = "Housekeeping",
            currentEventSequence = 0,
            deviceConfigVersion = 1,
            heartbeatIntervalMs = 15_000,
            payloadJson = "{\"snapshotSequence\":1}"
        )
    }

    private class FailingSnapshotClient(private val error: Throwable) : DeviceSnapshotClient {
        override suspend fun fetch(serverOrigin: String, deviceId: String, token: String): DeviceSessionSnapshot {
            throw error
        }
    }

    private class FakePairingStateStore : PairingStateStore {
        var configuration: ReceiverConfiguration? = null
        var token: String? = null
        var failReplace = false

        override fun readConfiguration(): ReceiverConfiguration? = configuration

        override suspend fun replace(configuration: ReceiverConfiguration, token: String): PairingStateRollback {
            if (failReplace) throw IllegalStateException("storage unavailable")
            val previousConfiguration = this.configuration
            val previousToken = this.token
            this.configuration = configuration
            this.token = token
            return PairingStateRollback {
                this.configuration = previousConfiguration
                this.token = previousToken
            }
        }
    }

    private class RecordingServiceController : ReceiverServiceController {
        var restartCalls = 0

        override fun restart() {
            restartCalls += 1
        }
    }

    private class FailingThenSuccessfulServiceController : ReceiverServiceController {
        var restartCalls = 0
        private var failuresRemaining = 1

        override fun restart() {
            restartCalls += 1
            if (failuresRemaining > 0) {
                failuresRemaining -= 1
                throw IllegalStateException("receiver restart failed")
            }
        }
    }
}
