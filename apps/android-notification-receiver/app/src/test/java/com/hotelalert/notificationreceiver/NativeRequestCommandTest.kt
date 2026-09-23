package com.hotelalert.notificationreceiver

import com.hotelalert.notificationreceiver.protocol.NativeRequestCommandClient
import com.hotelalert.notificationreceiver.protocol.NativeRequestCommandCoordinator
import com.hotelalert.notificationreceiver.protocol.NativeRequestTransition
import com.hotelalert.notificationreceiver.protocol.NativeRequestTargetStatus
import com.hotelalert.notificationreceiver.protocol.ReceiverConfiguration
import com.hotelalert.notificationreceiver.protocol.ReceiverConfigurationStore
import com.hotelalert.notificationreceiver.storage.DeviceTokenStore
import com.hotelalert.notificationreceiver.receiver.NativeReceiverSnapshotStore
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class NativeRequestCommandTest {
    @Test
    fun `parses a bounded transition payload`() {
        val request = NativeRequestTransition.parse(
            "{\"requestId\":\"req-1\",\"targetStatus\":\"IN_PROGRESS\",\"expectedVersion\":3,\"idempotencyKey\":\"transition-1\"}"
        )

        assertEquals("req-1", request.requestId)
        assertEquals(NativeRequestTargetStatus.IN_PROGRESS, request.targetStatus)
        assertEquals(3, request.expectedVersion)
    }

    @Test
    fun `executes a command with the token from the protected store`() = runTest {
        var observedToken: String? = null
        val client = object : NativeRequestCommandClient {
            override suspend fun transition(serverOrigin: String, deviceId: String, token: String, request: NativeRequestTransition): String {
                observedToken = token
                return "{\"ok\":true}"
            }
        }
        val coordinator = NativeRequestCommandCoordinator(
            configurationStore = FixedConfigurationStore(),
            tokenStore = FixedTokenStore("keystore-token"),
            snapshotStore = NativeReceiverSnapshotStore().also { it.update("{\"config\":{\"mode\":\"AREA\"}}") },
            client = client
        )

        val result = coordinator.transition(NativeRequestTransition("req-1", NativeRequestTargetStatus.COMPLETED, 4, "transition-1"))

        assertTrue(result is com.hotelalert.notificationreceiver.protocol.NativeRequestCommandResult.Success)
        assertEquals("keystore-token", observedToken)
    }

    private class FixedConfigurationStore : ReceiverConfigurationStore {
        override fun read(): ReceiverConfiguration = ReceiverConfiguration("https://hotel.test", "device-1", "client-1", "0.1.0")
        override fun write(configuration: ReceiverConfiguration) = Unit
    }

    private class FixedTokenStore(private val token: String) : DeviceTokenStore {
        override suspend fun read(): String = token
        override suspend fun write(token: String) = Unit
        override suspend fun clear() = Unit
    }
}
