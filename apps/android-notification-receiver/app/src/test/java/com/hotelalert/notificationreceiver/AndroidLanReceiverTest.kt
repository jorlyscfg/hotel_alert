package com.hotelalert.notificationreceiver

import com.hotelalert.notificationreceiver.protocol.DeviceSessionSnapshot
import com.hotelalert.notificationreceiver.protocol.DoNotDisturbNotification
import com.hotelalert.notificationreceiver.protocol.DurableCursorStore
import com.hotelalert.notificationreceiver.protocol.NotificationSink
import com.hotelalert.notificationreceiver.protocol.RequestNotification
import com.hotelalert.notificationreceiver.protocol.RealtimeSocket
import com.hotelalert.notificationreceiver.protocol.RealtimeSocketFactory
import com.hotelalert.notificationreceiver.protocol.ReceiverConfiguration
import com.hotelalert.notificationreceiver.protocol.ReceiverConfigurationStore
import com.hotelalert.notificationreceiver.protocol.ReceiverState
import com.hotelalert.notificationreceiver.protocol.DeviceSnapshotClient
import com.hotelalert.notificationreceiver.receiver.AndroidLanReceiver
import com.hotelalert.notificationreceiver.storage.DeviceTokenStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class AndroidLanReceiverTest {
    @Test
    fun terminalAuthenticationFailureDisablesSocketReconnection() = runTest {
        val socket = FakeSocket()
        val states = mutableListOf<ReceiverState>()
        val receiver = createReceiver(this, socket, states)

        receiver.start()
        socket.fire("connect_error", JSONObject().put("errorCode", "TOKEN_ROTATION_EXPIRED"))
        advanceUntilIdle()

        assertEquals(ReceiverState.AUTH_FAILED, states.last())
        assertTrue(socket.reconnectionDisabled)
        assertEquals(1, socket.disconnectCalls)
    }

    @Test
    fun reconnectRunsTheSynchronizationBarrierAndRestartsHeartbeat() = runTest {
        val socket = FakeSocket()
        val states = mutableListOf<ReceiverState>()
        val receiver = createReceiver(this, socket, states)

        receiver.start()
        socket.fire("connect")
        socket.fire("connection.ready", JSONObject().put("serverTime", "2026-09-19T00:00:00Z").put("currentEventSequence", 0).put("sync", "UP_TO_DATE"))
        runCurrent()
        assertEquals(ReceiverState.SYNCHRONIZED, states.last())

        socket.fire("disconnect", "transport close")
        assertEquals(ReceiverState.CONNECTING, states.last())
        socket.fire("connect")
        socket.fire("connection.ready", JSONObject().put("serverTime", "2026-09-19T00:00:01Z").put("currentEventSequence", 0).put("sync", "UP_TO_DATE"))
        runCurrent()
        advanceTimeBy(1_000)
        runCurrent()

        assertEquals(2, socket.emitted.count { it.eventName == "connection.sync" })
        assertTrue(socket.emitted.any { it.eventName == "device.heartbeat" })
        receiver.stop()
    }

    @Test
    fun repeatedSynchronizedStartRefreshesSnapshotWithoutReplacingSocket() = runTest {
        val socket = FakeSocket()
        val socketFactory = FakeSocketFactory(socket)
        val snapshotClient = CountingSnapshotClient(
            payloadJsons = listOf(
                """{"serverTime":"2026-09-19T00:00:00Z"}""",
                """{"serverTime":"2026-09-19T03:00:00Z"}"""
            )
        )
        val snapshots = mutableListOf<String?>()
        val receiver = createReceiver(
            this,
            socket,
            mutableListOf(),
            snapshotClient,
            onSnapshotChanged = { snapshots += it },
            socketFactory = socketFactory
        )

        receiver.start()
        socket.fire("connect")
        socket.fire("connection.ready", JSONObject().put("serverTime", "2026-09-19T00:00:00Z").put("currentEventSequence", 0).put("sync", "UP_TO_DATE"))
        runCurrent()

        receiver.start()

        assertEquals(2, snapshotClient.fetchCount)
        assertEquals("""{"serverTime":"2026-09-19T03:00:00Z"}""", snapshots.last())
        assertEquals(1, socketFactory.createCalls)
        assertEquals(0, socket.disconnectCalls)
        receiver.stop()
    }

    @Test
    fun syncRequiredRefreshesTheSnapshotBeforeContinuing() = runTest {
        val socket = FakeSocket()
        val snapshotClient = CountingSnapshotClient()
        val receiver = createReceiver(this, socket, mutableListOf(), snapshotClient)

        receiver.start()
        socket.fire("connect")
        socket.fire("sync.required", JSONObject().put("reason", "EVENT_GAP").put("currentEventSequence", 1))
        runCurrent()

        assertEquals(2, snapshotClient.fetchCount)
        assertTrue(socket.emitted.any { it.eventName == "connection.sync" })
        receiver.stop()
    }

    @Test
    fun requestEventsRefreshTheNativeSnapshotForTheWebViewConsole() = runTest {
        val socket = FakeSocket()
        val snapshotClient = CountingSnapshotClient()
        val receiver = createReceiver(this, socket, mutableListOf(), snapshotClient)

        receiver.start()
        socket.fire("connect")
        socket.fire("connection.ready", JSONObject().put("serverTime", "2026-09-19T00:00:00Z").put("currentEventSequence", 0).put("sync", "UP_TO_DATE"))
        runCurrent()
        assertEquals(1, snapshotClient.fetchCount)

        socket.fire("request.created", requestCreatedEvent("event-request-1", 1, "area-a"))
        runCurrent()

        assertEquals(2, snapshotClient.fetchCount)
        receiver.stop()
    }

    @Test
    fun roomUpdatesRefreshTheNativeSnapshotDeliveredToTheWebViewConsole() = runTest {
        val socket = FakeSocket()
        val initialSnapshot = """{"device":{"id":"device-1","assignmentMode":"AREA"},"config":{"mode":"AREA"},"activeDoNotDisturbRooms":[]}"""
        val updatedSnapshot = """{"device":{"id":"device-1","assignmentMode":"AREA"},"config":{"mode":"AREA"},"activeDoNotDisturbRooms":[{"id":"room-1","code":"101","displayName":"101","doNotDisturb":true}]}"""
        val snapshotClient = CountingSnapshotClient(listOf(initialSnapshot, updatedSnapshot))
        val deliveredSnapshots = mutableListOf<String?>()
        val receiver = createReceiver(
            scope = this,
            socket = socket,
            states = mutableListOf(),
            snapshotClient = snapshotClient,
            onSnapshotChanged = { deliveredSnapshots += it }
        )

        receiver.start()
        socket.fire("connect")
        socket.fire("connection.ready", JSONObject().put("serverTime", "2026-09-19T00:00:00Z").put("currentEventSequence", 0).put("sync", "UP_TO_DATE"))
        runCurrent()
        assertEquals(listOf(initialSnapshot), deliveredSnapshots)

        socket.fire("room.updated", roomUpdatedEvent("event-room-1", 1, "room-1"))
        runCurrent()

        assertEquals(2, snapshotClient.fetchCount)
        assertEquals(listOf(initialSnapshot, updatedSnapshot), deliveredSnapshots)
        receiver.stop()
    }

    @Test
    fun roomDndTransitionsUseTheLatestAuthoritativeSnapshotBaseline() = runTest {
        val socket = FakeSocket()
        val snapshotClient = DoNotDisturbSnapshotClient()
        val sink = RecordingDoNotDisturbSink()
        val cursor = FakeCursorStore()
        val receiver = createReceiver(this, socket, mutableListOf(), snapshotClient, sink, cursor)

        receiver.start()
        socket.fire("connect")
        socket.fire("connection.ready", JSONObject().put("serverTime", "2026-09-19T00:00:00Z").put("currentEventSequence", 0).put("sync", "UP_TO_DATE"))
        runCurrent()

        socket.fire("room.updated", roomUpdatedEvent("event-dnd-on", 1, "room-1", enabled = true))
        runCurrent()
        socket.fire("room.updated", roomUpdatedEvent("event-dnd-off", 2, "room-1", enabled = false))
        runCurrent()

        assertEquals(listOf(true, false), sink.delivered.map(DoNotDisturbNotification::enabled))
        assertEquals(3, snapshotClient.fetchCount)
        assertEquals(2L, cursor.lastSeenEventSequence)
        receiver.stop()
    }

    @Test
    fun bufferedDndTransitionSurvivesSnapshotRefreshThatAlreadyContainsItsState() = runTest {
        val socket = FakeSocket()
        val snapshotClient = RacingDoNotDisturbSnapshotClient()
        val sink = RecordingDoNotDisturbSink()
        val cursor = FakeCursorStore()
        val receiver = createReceiver(this, socket, mutableListOf(), snapshotClient, sink, cursor)

        receiver.start()
        socket.fire("connect")
        socket.fire("connection.ready", JSONObject().put("serverTime", "2026-09-19T00:00:00Z").put("currentEventSequence", 0).put("sync", "UP_TO_DATE"))
        runCurrent()

        socket.fire("room.updated", roomUpdatedEvent("event-dnd-on-race", 1, "room-1", enabled = true))
        runCurrent()
        assertEquals(listOf(true), sink.delivered.map(DoNotDisturbNotification::enabled))

        socket.fire("room.updated", roomUpdatedEvent("event-dnd-off-race", 2, "room-1", enabled = false))
        runCurrent()
        snapshotClient.releaseRefresh.complete(Unit)
        runCurrent()

        assertEquals(listOf(true, false), sink.delivered.map(DoNotDisturbNotification::enabled))
        assertEquals(2L, cursor.lastSeenEventSequence)
        receiver.stop()
    }

    @Test
    fun failedStartupCanBeRetriedAfterTransientError() = runTest {
        val socket = FakeSocket()
        val states = mutableListOf<ReceiverState>()
        val snapshotClient = FailingOnceSnapshotClient()
        val receiver = createReceiver(this, socket, states, snapshotClient)

        receiver.start()
        assertEquals(ReceiverState.ERROR, states.last())

        receiver.start()

        assertEquals(2, snapshotClient.fetchCount)
        assertEquals(ReceiverState.CONNECTING, states.last())
        receiver.stop()
    }

    @Test
    fun failedEventIsRequeuedBeforeLaterEventsCanBeDelivered() = runTest {
        val socket = FakeSocket()
        val cursor = FakeCursorStore()
        val sink = FailingOnceSink()
        val receiver = createReceiver(this, socket, mutableListOf(), sink = sink, cursor = cursor)
        val failedEvent = requestCreatedEvent("event-10", 10, "area-a")
        val laterEvent = requestCreatedEvent("event-11", 11, "area-a", aggregateVersion = 2L)

        receiver.start()
        socket.fire("connect")
        socket.fire(
            "connection.ready",
            JSONObject()
                .put("serverTime", "2026-09-19T00:00:00Z")
                .put("currentEventSequence", 0)
                .put("sync", "UP_TO_DATE")
        )
        runCurrent()

        socket.fire("request.created", failedEvent)
        runCurrent()
        socket.fire("request.created", laterEvent)
        runCurrent()

        assertEquals(0L, cursor.lastSeenEventSequence)
        assertTrue(sink.delivered.isEmpty())

        socket.fire("disconnect")
        socket.fire("connect")
        socket.fire(
            "connection.ready",
            JSONObject()
                .put("serverTime", "2026-09-19T00:00:01Z")
                .put("currentEventSequence", 0)
                .put("sync", "UP_TO_DATE")
        )
        runCurrent()
        runCurrent()

        assertEquals(listOf("event-10", "event-11"), sink.delivered.map(RequestNotification::eventId))
        assertEquals(11L, cursor.lastSeenEventSequence)
        receiver.stop()
    }

    @Test
    fun snapshotAuthenticationFailureUsesTheAuthFailedState() = runTest {
        val socket = FakeSocket()
        val states = mutableListOf<ReceiverState>()
        val authFailures = mutableListOf<String>()
        val errors = mutableListOf<String>()
        val receiver = createReceiver(
            scope = this,
            socket = socket,
            states = states,
            snapshotClient = FailingSnapshotClient(IllegalStateException("AUTH_REQUIRED")),
            onAuthFailure = { authFailures += it },
            onError = { errors += it }
        )

        receiver.start()

        assertEquals(ReceiverState.AUTH_FAILED, states.last())
        assertEquals(listOf("AUTH_REQUIRED"), authFailures)
        assertTrue(errors.isEmpty())
    }

    @Test
    fun definitiveDeviceInvalidationRequestsPersistentAssignmentCleanup() = runTest {
        val invalidationCodes = mutableListOf<String>()
        val receiver = createReceiver(
            scope = this,
            socket = FakeSocket(),
            states = mutableListOf(),
            snapshotClient = FailingSnapshotClient(com.hotelalert.notificationreceiver.protocol.DeviceSnapshotException(403, "DEVICE_INACTIVE")),
            onDeviceInvalidated = { invalidationCodes += it }
        )

        receiver.start()

        assertEquals(listOf("DEVICE_INACTIVE"), invalidationCodes)
    }

    @Test
    fun invalidAreaAssignmentClearsPairingBeforeReceiverCanConnect() = runTest {
        val states = mutableListOf<ReceiverState>()
        val authFailures = mutableListOf<String>()
        val invalidationCodes = mutableListOf<String>()
        val receiver = createReceiver(
            scope = this,
            socket = FakeSocket(),
            states = states,
            snapshotClient = FailingSnapshotClient(
                com.hotelalert.notificationreceiver.protocol.DeviceSnapshotAssignmentException(
                    "FORBIDDEN_ASSIGNMENT",
                    "The device must have an AREA assignment."
                )
            ),
            onAuthFailure = { authFailures += it },
            onDeviceInvalidated = { invalidationCodes += it }
        )

        receiver.start()

        assertEquals(ReceiverState.AUTH_FAILED, states.last())
        assertEquals(listOf("FORBIDDEN_ASSIGNMENT"), authFailures)
        assertEquals(listOf("FORBIDDEN_ASSIGNMENT"), invalidationCodes)
    }

    @Test
    fun deviceIdMismatchDoesNotAutomaticallyInvalidateTheAssignment() = runTest {
        val states = mutableListOf<ReceiverState>()
        val authFailures = mutableListOf<String>()
        val invalidationCodes = mutableListOf<String>()
        val receiver = createReceiver(
            scope = this,
            socket = FakeSocket(),
            states = states,
            snapshotClient = FailingSnapshotClient(
                com.hotelalert.notificationreceiver.protocol.DeviceSnapshotAssignmentException(
                    "DEVICE_ID_MISMATCH",
                    "The device session snapshot does not match the configured device."
                )
            ),
            onAuthFailure = { authFailures += it },
            onDeviceInvalidated = { invalidationCodes += it }
        )

        receiver.start()

        assertEquals(ReceiverState.AUTH_FAILED, states.last())
        assertEquals(listOf("DEVICE_ID_MISMATCH"), authFailures)
        assertTrue(invalidationCodes.isEmpty())
    }

    @Test
    fun tokenRotationRequiredStopsWithoutAdvancingOrAcknowledgingTheEvent() = runTest {
        val socket = FakeSocket()
        val cursor = FakeCursorStore()
        val states = mutableListOf<ReceiverState>()
        val authFailures = mutableListOf<String>()
        val invalidationCodes = mutableListOf<String>()
        val receiver = createReceiver(
            scope = this,
            socket = socket,
            states = states,
            cursor = cursor,
            onAuthFailure = { authFailures += it },
            onDeviceInvalidated = { invalidationCodes += it }
        )
        val rotationEvent = JSONObject()
            .put("schemaVersion", 1)
            .put("eventId", "rotation-event-1")
            .put("eventSequence", 12)
            .put("name", "device.token.rotation.required")
            .put("occurredAt", "2026-09-19T00:00:00Z")
            .put("aggregateType", "DEVICE")
            .put("aggregateId", "device-1")
            .put("aggregateVersion", 2)
            .put(
                "payload",
                JSONObject()
                    .put("deviceId", "device-1")
                    .put("rotationId", "rotation-1")
                    .put("state", "ROTATION_PENDING")
                    .put("graceExpiresAt", "2026-09-19T01:00:00Z")
                    .put("configurationRevision", 3)
            )

        receiver.start()
        socket.fire("connect")
        socket.fire(
            "connection.ready",
            JSONObject()
                .put("serverTime", "2026-09-19T00:00:00Z")
                .put("currentEventSequence", 0)
                .put("sync", "UP_TO_DATE")
        )
        runCurrent()

        socket.fire("device.token.rotation.required", rotationEvent)
        runCurrent()

        assertEquals(ReceiverState.AUTH_FAILED, states.last())
        assertEquals(listOf("TOKEN_ROTATION_REQUIRED"), authFailures)
        assertTrue(invalidationCodes.isEmpty())
        assertEquals(0L, cursor.lastSeenEventSequence)
        assertTrue(socket.emitted.none { it.eventName == "client.event.received" })
    }

    private fun createReceiver(
        scope: CoroutineScope,
        socket: FakeSocket,
        states: MutableList<ReceiverState>,
        snapshotClient: DeviceSnapshotClient = CountingSnapshotClient(),
        sink: NotificationSink = NoopSink(),
        cursor: FakeCursorStore = FakeCursorStore(),
        onAuthFailure: (String) -> Unit = {},
        onError: (String) -> Unit = {},
        onDeviceInvalidated: (String) -> Unit = {},
        onSnapshotChanged: (String?) -> Unit = {},
        socketFactory: FakeSocketFactory = FakeSocketFactory(socket)
    ): AndroidLanReceiver = AndroidLanReceiver(
        configurationStore = FakeConfigurationStore(),
        tokenStore = FakeTokenStore(),
        cursorStore = cursor,
        snapshotClient = snapshotClient,
        socketFactory = socketFactory,
        sink = sink,
        scope = scope,
        onStateChanged = { states += it },
        onAuthFailure = onAuthFailure,
        onError = onError,
        onDeviceInvalidated = onDeviceInvalidated,
        onSnapshotChanged = onSnapshotChanged
    )

    private fun roomUpdatedEvent(eventId: String, eventSequence: Long, roomId: String, enabled: Boolean = true): JSONObject = JSONObject()
        .put("schemaVersion", 1)
        .put("eventId", eventId)
        .put("eventSequence", eventSequence)
        .put("name", "room.updated")
        .put("occurredAt", "2026-09-19T00:00:00Z")
        .put("aggregateType", "ROOM")
        .put("aggregateId", roomId)
        .put(
            "payload",
            JSONObject().put(
                "room",
                JSONObject()
                    .put("id", roomId)
                    .put("code", "101")
                    .put("displayName", "101")
                    .put("active", true)
                    .put("doNotDisturb", enabled)
                    .put("createdAt", "2026-09-19T00:00:00Z")
                    .put("updatedAt", "2026-09-19T00:00:00Z")
            )
        )

    private class FakeConfigurationStore : ReceiverConfigurationStore {
        private var configuration = ReceiverConfiguration(
            serverOrigin = "http://127.0.0.1:3000",
            deviceId = "device-1",
            clientInstanceId = "client-1",
            clientVersion = "0.1.0"
        )

        override fun read(): ReceiverConfiguration = configuration

        override fun write(configuration: ReceiverConfiguration) {
            this.configuration = configuration
        }
    }

    private class FakeTokenStore : DeviceTokenStore {
        override suspend fun read(): String = "test-token-not-logged"
        override suspend fun write(token: String) = Unit
        override suspend fun clear() = Unit
    }

    private class FakeCursorStore : DurableCursorStore {
        override var lastSeenEventSequence: Long = 0
            private set

        override suspend fun advanceTo(eventSequence: Long) {
            lastSeenEventSequence = eventSequence
        }
    }

    private class NoopSink : NotificationSink {
        override suspend fun deliver(notification: RequestNotification) = Unit
    }

    private class RecordingDoNotDisturbSink : NotificationSink {
        val delivered = mutableListOf<DoNotDisturbNotification>()

        override suspend fun deliver(notification: RequestNotification) = Unit

        override suspend fun deliver(notification: DoNotDisturbNotification) {
            delivered += notification
        }
    }

    private class DoNotDisturbSnapshotClient : DeviceSnapshotClient {
        var fetchCount = 0

        override suspend fun fetch(serverOrigin: String, deviceId: String, token: String): DeviceSessionSnapshot {
            fetchCount += 1
            return DeviceSessionSnapshot(
                deviceId = deviceId,
                areaId = "area-a",
                areaDisplayName = "Housekeeping",
                currentEventSequence = 0,
                deviceConfigVersion = 1,
                heartbeatIntervalMs = 1_000,
                activeDoNotDisturbRoomIds = if (fetchCount == 1) emptySet() else setOf("room-1")
            )
        }
    }

    private class RacingDoNotDisturbSnapshotClient : DeviceSnapshotClient {
        var fetchCount = 0
        val releaseRefresh = CompletableDeferred<Unit>()

        override suspend fun fetch(serverOrigin: String, deviceId: String, token: String): DeviceSessionSnapshot {
            fetchCount += 1
            if (fetchCount == 2) releaseRefresh.await()
            return DeviceSessionSnapshot(
                deviceId = deviceId,
                areaId = "area-a",
                areaDisplayName = "Housekeeping",
                currentEventSequence = if (fetchCount == 1) 0 else 2,
                deviceConfigVersion = 1,
                heartbeatIntervalMs = 1_000,
                activeDoNotDisturbRoomIds = emptySet()
            )
        }
    }

    private class FailingOnceSink : NotificationSink {
        var failuresRemaining = 1
        val delivered = mutableListOf<RequestNotification>()

        override suspend fun deliver(notification: RequestNotification) {
            if (failuresRemaining > 0) {
                failuresRemaining -= 1
                throw IllegalStateException("sink unavailable")
            }
            delivered += notification
        }
    }

    private class CountingSnapshotClient(private val payloadJsons: List<String?> = emptyList()) : DeviceSnapshotClient {
        var fetchCount = 0

        override suspend fun fetch(serverOrigin: String, deviceId: String, token: String): DeviceSessionSnapshot {
            fetchCount += 1
            return DeviceSessionSnapshot(
                deviceId = deviceId,
                areaId = "area-a",
                areaDisplayName = "Housekeeping",
                currentEventSequence = 0,
                deviceConfigVersion = 1,
                heartbeatIntervalMs = 1_000,
                payloadJson = payloadJsons.getOrNull(fetchCount - 1)
            )
        }
    }

    private class FailingOnceSnapshotClient : DeviceSnapshotClient {
        var fetchCount = 0

        override suspend fun fetch(serverOrigin: String, deviceId: String, token: String): DeviceSessionSnapshot {
            fetchCount += 1
            if (fetchCount == 1) throw IllegalStateException("temporary snapshot failure")
            return DeviceSessionSnapshot(
                deviceId = deviceId,
                areaId = "area-a",
                areaDisplayName = "Housekeeping",
                currentEventSequence = 0,
                deviceConfigVersion = 1,
                heartbeatIntervalMs = 1_000
            )
        }
    }

    private class FailingSnapshotClient(private val error: Throwable) : DeviceSnapshotClient {
        override suspend fun fetch(serverOrigin: String, deviceId: String, token: String): DeviceSessionSnapshot {
            throw error
        }
    }

    private class FakeSocketFactory(private val socket: FakeSocket) : RealtimeSocketFactory {
        var createCalls = 0

        override fun create(serverOrigin: String, auth: JSONObject): RealtimeSocket {
            createCalls += 1
            return socket
        }
    }

    private class FakeSocket : RealtimeSocket {
        override var connected: Boolean = false
        var reconnectionDisabled = false
        var disconnectCalls = 0
        val emitted = mutableListOf<Emission>()
        private val listeners = mutableMapOf<String, MutableList<(Any?) -> Unit>>()

        override fun on(eventName: String, listener: (Any?) -> Unit): RealtimeSocket {
            listeners.getOrPut(eventName) { mutableListOf() } += listener
            return this
        }

        override fun off(eventName: String, listener: (Any?) -> Unit): RealtimeSocket {
            listeners[eventName]?.remove(listener)
            return this
        }

        override fun updateAuth(auth: JSONObject): RealtimeSocket = this

        override fun emit(eventName: String, payload: JSONObject, acknowledgement: (JSONObject?) -> Unit): RealtimeSocket {
            emitted += Emission(eventName, payload)
            acknowledgement(JSONObject().put("ok", true).put("sync", "UP_TO_DATE"))
            return this
        }

        override fun connect(): RealtimeSocket {
            connected = true
            return this
        }

        override fun disconnect(): RealtimeSocket {
            connected = false
            disconnectCalls += 1
            return this
        }

        override fun disableReconnection() {
            reconnectionDisabled = true
        }

        fun fire(eventName: String, payload: Any? = null) {
            if (eventName == "connect") connected = true
            if (eventName == "disconnect") connected = false
            listeners[eventName]?.toList()?.forEach { it(payload) }
        }
    }

    private data class Emission(val eventName: String, val payload: JSONObject)
}
