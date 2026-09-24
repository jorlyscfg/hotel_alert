package com.hotelalert.notificationreceiver

import com.hotelalert.notificationreceiver.protocol.NativeRoomSessionCoordinator
import com.hotelalert.notificationreceiver.protocol.RoomPresenceClient
import com.hotelalert.notificationreceiver.protocol.RoomPresenceConfiguration
import com.hotelalert.notificationreceiver.protocol.RoomPresenceCoordinator
import com.hotelalert.notificationreceiver.protocol.RoomPresenceCycle
import com.hotelalert.notificationreceiver.protocol.RoomPresenceException
import com.hotelalert.notificationreceiver.protocol.RoomPresenceSession
import com.hotelalert.notificationreceiver.protocol.RoomPresenceSessionStore
import com.hotelalert.notificationreceiver.protocol.RoomPresenceSnapshot
import com.hotelalert.notificationreceiver.protocol.RoomPresenceState
import com.hotelalert.notificationreceiver.protocol.RoomPresenceStatusStore
import com.hotelalert.notificationreceiver.protocol.RoomPresenceServiceController
import com.hotelalert.notificationreceiver.web.ServerOriginStore
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class RoomPresenceTest {
    @Test
    fun `stale browser rehydration preserves native staged token after rotation ack`() = runTest {
        val store = FakeRoomSessionStore().apply {
            session = RoomPresenceSession(configuration, "revoked-browser-token")
            stagedToken = "server-acknowledged-token"
        }
        val service = RecordingRoomServiceController()
        val coordinator = NativeRoomSessionCoordinator(
            FixedOriginStore,
            store,
            service,
            RoomPresenceStatusStore(),
            "0.1.0"
        )

        coordinator.configure("room-device", "revoked-browser-token")

        assertEquals("revoked-browser-token", store.session?.token)
        assertEquals("server-acknowledged-token", store.stagedToken)
        assertEquals(1, service.starts)
    }

    @Test
    fun `staged token is promoted only after session and heartbeat validate it`() = runTest {
        val store = FakeRoomSessionStore().apply {
            session = RoomPresenceSession(configuration, "revoked-token")
            stagedToken = "replacement-token"
        }
        val validatedTokens = mutableListOf<String>()
        val client = object : RoomPresenceClient {
            override suspend fun fetchSession(serverOrigin: String, deviceId: String, token: String): RoomPresenceSnapshot {
                validatedTokens += "session:$token"
                if (token == "revoked-token") throw RoomPresenceException(401, "DEVICE_TOKEN_REVOKED")
                return RoomPresenceSnapshot(deviceId, "ROOM", true, "room-1", 15_000)
            }

            override suspend fun sendHeartbeat(serverOrigin: String, deviceId: String, token: String, clientVersion: String) {
                validatedTokens += "heartbeat:$token"
                assertEquals("revoked-token", store.session?.token)
                assertEquals("replacement-token", store.stagedToken)
            }
        }
        val status = RoomPresenceStatusStore()

        val result = RoomPresenceCoordinator(store, client, status).runOnce()

        assertEquals(RoomPresenceCycle.Online(15_000), result)
        assertEquals(listOf("session:revoked-token", "session:replacement-token", "heartbeat:replacement-token"), validatedTokens)
        assertEquals("replacement-token", store.session?.token)
        assertNull(store.stagedToken)
        assertEquals(RoomPresenceState.ONLINE, status.state)
    }

    @Test
    fun `a newer staged replacement is not promoted by validation of the older token`() = runTest {
        val store = FakeRoomSessionStore().apply {
            session = RoomPresenceSession(configuration, "revoked-token")
            stagedToken = "validated-token"
        }
        val client = object : RoomPresenceClient {
            override suspend fun fetchSession(serverOrigin: String, deviceId: String, token: String): RoomPresenceSnapshot {
                if (token == "revoked-token") throw RoomPresenceException(401, "DEVICE_TOKEN_REVOKED")
                return RoomPresenceSnapshot(deviceId, "ROOM", true, "room-1", 15_000)
            }

            override suspend fun sendHeartbeat(serverOrigin: String, deviceId: String, token: String, clientVersion: String) {
                store.stagedToken = "newer-not-yet-validated-token"
            }
        }

        val status = RoomPresenceStatusStore()
        val result = RoomPresenceCoordinator(store, client, status).runOnce()

        assertEquals(RoomPresenceCycle.Retry("ROOM_TOKEN_CHANGED_DURING_VALIDATION"), result)
        assertEquals("revoked-token", store.session?.token)
        assertEquals("newer-not-yet-validated-token", store.stagedToken)
        assertEquals(RoomPresenceState.RETRYING, status.state)
    }

    @Test
    fun `transient server failure retains ROOM credentials for retry`() = runTest {
        val store = FakeRoomSessionStore().apply { session = RoomPresenceSession(configuration, "valid-token") }
        val client = object : RoomPresenceClient {
            override suspend fun fetchSession(serverOrigin: String, deviceId: String, token: String): RoomPresenceSnapshot {
                throw RoomPresenceException(503, "SERVICE_UNAVAILABLE")
            }

            override suspend fun sendHeartbeat(serverOrigin: String, deviceId: String, token: String, clientVersion: String) = Unit
        }

        val result = RoomPresenceCoordinator(store, client, RoomPresenceStatusStore()).runOnce()

        assertEquals(RoomPresenceCycle.Retry("SERVICE_UNAVAILABLE"), result)
        assertEquals("valid-token", store.session?.token)
        assertFalse(store.invalidated)
        assertNull(store.stagedToken)
    }

    @Test
    fun `generic unauthorized response does not erase ROOM credentials`() = runTest {
        val store = FakeRoomSessionStore().apply { session = RoomPresenceSession(configuration, "valid-token") }
        val client = object : RoomPresenceClient {
            override suspend fun fetchSession(serverOrigin: String, deviceId: String, token: String): RoomPresenceSnapshot {
                throw RoomPresenceException(401, "AUTH_INVALID")
            }

            override suspend fun sendHeartbeat(serverOrigin: String, deviceId: String, token: String, clientVersion: String) = Unit
        }

        val result = RoomPresenceCoordinator(store, client, RoomPresenceStatusStore()).runOnce()

        assertEquals(RoomPresenceCycle.Retry("AUTH_INVALID"), result)
        assertEquals("valid-token", store.session?.token)
        assertFalse(store.invalidated)
    }

    @Test
    fun `confirmed inactive assignment clears ROOM credentials`() = runTest {
        val store = FakeRoomSessionStore().apply { session = RoomPresenceSession(configuration, "inactive-token") }
        val client = object : RoomPresenceClient {
            override suspend fun fetchSession(serverOrigin: String, deviceId: String, token: String): RoomPresenceSnapshot {
                throw RoomPresenceException(403, "DEVICE_INACTIVE")
            }

            override suspend fun sendHeartbeat(serverOrigin: String, deviceId: String, token: String, clientVersion: String) = Unit
        }
        val status = RoomPresenceStatusStore()

        val result = RoomPresenceCoordinator(store, client, status).runOnce()

        assertEquals(RoomPresenceCycle.Invalidated, result)
        assertNull(store.session)
        assertTrue(store.invalidated)
        assertEquals(RoomPresenceState.INVALIDATED, status.state)
    }

    private class FakeRoomSessionStore : RoomPresenceSessionStore {
        var session: RoomPresenceSession? = null
        var stagedToken: String? = null
        var invalidated = false

        override suspend fun read(): RoomPresenceSession? = session

        override suspend fun replace(configuration: RoomPresenceConfiguration, token: String) {
            session = RoomPresenceSession(configuration, token)
            stagedToken = null
            invalidated = false
        }

        override suspend fun stageToken(token: String) {
            stagedToken = token
        }

        override suspend fun readStagedToken(): String? = stagedToken

        override suspend fun activateStagedToken(configuration: RoomPresenceConfiguration, expectedToken: String): Boolean {
            if (session?.configuration != configuration || stagedToken != expectedToken) return false
            val current = session ?: return false
            session = current.copy(token = expectedToken)
            stagedToken = null
            return true
        }

        override suspend fun clear(invalidated: Boolean) {
            session = null
            stagedToken = null
            this.invalidated = invalidated
        }

        override fun wasInvalidated(): Boolean = invalidated
    }

    private class RecordingRoomServiceController : RoomPresenceServiceController {
        var starts = 0
        override fun start() { starts += 1 }
        override fun stop() = Unit
    }

    private object FixedOriginStore : ServerOriginStore {
        override fun read(): String = "https://hotel.test"
        override fun write(serverOrigin: String) = Unit
    }

    companion object {
        private val configuration = RoomPresenceConfiguration("https://hotel.test", "room-device", "0.1.0")
    }
}
