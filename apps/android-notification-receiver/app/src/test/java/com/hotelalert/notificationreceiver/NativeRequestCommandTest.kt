package com.hotelalert.notificationreceiver

import com.hotelalert.notificationreceiver.protocol.NativeRequestCommandClient
import com.hotelalert.notificationreceiver.protocol.NativeRequestCommandCoordinator
import com.hotelalert.notificationreceiver.protocol.NativeRequestCommandException
import com.hotelalert.notificationreceiver.protocol.NativeRequestCommandResult
import com.hotelalert.notificationreceiver.protocol.NativeRequestTransition
import com.hotelalert.notificationreceiver.protocol.NativeRequestTargetStatus
import com.hotelalert.notificationreceiver.protocol.ReceiverConfiguration
import com.hotelalert.notificationreceiver.protocol.ReceiverConfigurationStore
import com.hotelalert.notificationreceiver.storage.DeviceTokenStore
import com.hotelalert.notificationreceiver.receiver.NativeReceiverSnapshotStore
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class NativeRequestCommandTest {
    @Test
    fun `parses a bounded transition payload`() {
        val request = NativeRequestTransition.parse(
            "{\"requestId\":\"req-1\",\"targetStatus\":\"IN_PROGRESS\",\"expectedVersion\":3,\"idempotencyKey\":\"transition-1\",\"responsibleName\":\"  Taylor Morgan  \"}"
        )

        assertEquals("req-1", request.requestId)
        assertEquals(NativeRequestTargetStatus.IN_PROGRESS, request.targetStatus)
        assertEquals(3, request.expectedVersion)
        assertEquals("Taylor Morgan", request.responsibleName)
    }

    @Test
    fun `rejects an in-progress transition without a responsible person`() {
        val result = runCatching {
            NativeRequestTransition.parse(
                "{\"requestId\":\"req-1\",\"targetStatus\":\"IN_PROGRESS\",\"expectedVersion\":3,\"idempotencyKey\":\"transition-1\",\"responsibleName\":\"   \"}"
            )
        }

        assertFalse(result.isSuccess)
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

    @Test
    fun `preserves the server request id in a command failure`() = runTest {
        val coordinator = NativeRequestCommandCoordinator(
            configurationStore = FixedConfigurationStore(),
            tokenStore = FixedTokenStore("keystore-token"),
            snapshotStore = NativeReceiverSnapshotStore().also { it.update("{\"config\":{\"mode\":\"AREA\"}}") },
            client = object : NativeRequestCommandClient {
                override suspend fun transition(serverOrigin: String, deviceId: String, token: String, request: NativeRequestTransition): String {
                    throw NativeRequestCommandException(500, "INTERNAL_ERROR", "server-request-12345678")
                }
            }
        )

        val result = coordinator.transition(NativeRequestTransition("req-1", NativeRequestTargetStatus.IN_PROGRESS, 4, "transition-1", "Taylor Morgan"))

        assertEquals(NativeRequestCommandResult.Failure("INTERNAL_ERROR", "server-request-12345678"), result)
    }

    @Test
    fun `bounds the server request reference before exposing it`() {
        val unsafeReference = NativeRequestCommandException(500, "INTERNAL_ERROR", "server request with spaces")
        val overlongReference = NativeRequestCommandException(500, "INTERNAL_ERROR", "r".repeat(129))

        assertNull(unsafeReference.serverRequestId)
        assertNull(overlongReference.serverRequestId)
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
