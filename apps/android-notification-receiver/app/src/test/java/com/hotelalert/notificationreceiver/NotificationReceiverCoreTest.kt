package com.hotelalert.notificationreceiver

import com.hotelalert.notificationreceiver.notification.NotificationAction
import com.hotelalert.notificationreceiver.notification.NotificationMapper
import com.hotelalert.notificationreceiver.protocol.DurableCursorStore
import com.hotelalert.notificationreceiver.protocol.DoNotDisturbNotification
import com.hotelalert.notificationreceiver.protocol.NotificationReceiverCore
import com.hotelalert.notificationreceiver.protocol.NotificationSink
import com.hotelalert.notificationreceiver.protocol.RequestNotification
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationReceiverCoreTest {
    @Test
    fun deliversOnlyAnEligibleEventForTheAssignedArea() = runTest {
        val cursor = TestCursor()
        val sink = RecordingSink()
        val receiver = NotificationReceiverCore("area-a", cursor, sink)

        val result = receiver.handle(requestCreatedEvent("event-1", 1, "area-a"), synchronized = true)

        assertEquals(NotificationReceiverCore.HandleOutcome.DELIVERED, result.outcome)
        assertEquals(1L, cursor.lastSeenEventSequence)
        assertEquals(listOf("event-1"), sink.delivered.map(RequestNotification::eventId))
    }

    @Test
    fun ignoresAnEventForAnotherAreaAfterAdvancingTheCursor() = runTest {
        val cursor = TestCursor()
        val receiver = NotificationReceiverCore("area-a", cursor, RecordingSink())

        val result = receiver.handle(requestCreatedEvent("event-2", 2, "area-b"), synchronized = true)

        assertEquals(NotificationReceiverCore.IgnoreReason.UNASSIGNED_AREA, result.reason)
        assertEquals(2L, cursor.lastSeenEventSequence)
        assertTrue(result.cursorAdvanced)
    }

    @Test
    fun defersEventsUntilTheConnectionIsSynchronized() = runTest {
        val cursor = TestCursor()
        val receiver = NotificationReceiverCore("area-a", cursor, RecordingSink())

        val result = receiver.handle(requestCreatedEvent("event-3", 3, "area-a"), synchronized = false)

        assertEquals(NotificationReceiverCore.HandleOutcome.DEFERRED, result.outcome)
        assertEquals(0L, cursor.lastSeenEventSequence)
    }

    @Test
    fun suppressesDuplicateAndOutOfOrderEvents() = runTest {
        val cursor = TestCursor()
        val sink = RecordingSink()
        val receiver = NotificationReceiverCore("area-a", cursor, sink)
        receiver.handle(requestCreatedEvent("event-4", 4, "area-a"), synchronized = true)

        val duplicate = receiver.handle(requestCreatedEvent("event-4", 4, "area-a"), synchronized = true)
        val older = receiver.handle(requestCreatedEvent("event-5", 3, "area-a"), synchronized = true)

        assertEquals(NotificationReceiverCore.IgnoreReason.DUPLICATE, duplicate.reason)
        assertEquals(NotificationReceiverCore.IgnoreReason.OUT_OF_ORDER, older.reason)
        assertEquals(1, sink.delivered.size)
    }

    @Test
    fun malformedRecognizedRequestEventDoesNotAdvanceTheCursor() = runTest {
        val cursor = TestCursor()
        val receiver = NotificationReceiverCore("area-a", cursor, RecordingSink())
        val malformed = requestCreatedEvent("event-6", 6, "area-a").apply {
            getJSONObject("payload").getJSONObject("request").remove("service")
        }

        val result = receiver.handle(malformed, synchronized = true)

        assertEquals(NotificationReceiverCore.IgnoreReason.UNSUPPORTED_EVENT, result.reason)
        assertFalse(result.cursorAdvanced)
        assertEquals(0L, cursor.lastSeenEventSequence)
    }

    @Test
    fun sinkFailureBlocksLaterEventsUntilTheFailedEventIsRetried() = runTest {
        val cursor = TestCursor()
        val sink = RecordingSink(failuresRemaining = 1)
        val receiver = NotificationReceiverCore("area-a", cursor, sink)
        val first = requestCreatedEvent("event-7", 7, "area-a")
        val later = requestCreatedEvent("event-8", 8, "area-a", aggregateVersion = 2L)

        assertSuspendingFailure { receiver.handle(first, synchronized = true) }
        assertSuspendingFailure { receiver.handle(later, synchronized = true) }

        val retried = receiver.handle(first, synchronized = true)
        val afterRetry = receiver.handle(later, synchronized = true)

        assertEquals(NotificationReceiverCore.HandleOutcome.DELIVERED, retried.outcome)
        assertEquals(NotificationReceiverCore.HandleOutcome.DELIVERED, afterRetry.outcome)
        assertEquals(8L, cursor.lastSeenEventSequence)
    }

    @Test
    fun roomDoNotDisturbTransitionsAlertOnlyAgainstTheSnapshotBaseline() = runTest {
        val cursor = TestCursor()
        val sink = RecordingSink()
        val receiver = NotificationReceiverCore(
            "area-a",
            cursor,
            sink,
            initialActiveDoNotDisturbRoomIds = emptySet()
        )

        val activation = roomUpdatedEvent("event-dnd-on", 1, enabled = true)
        receiver.handle(activation, synchronized = true)
        val duplicate = receiver.handle(activation, synchronized = true)
        val older = receiver.handle(roomUpdatedEvent("event-dnd-old", 0, enabled = false), synchronized = true)
        val metadataOnly = receiver.handle(
            roomUpdatedEvent("event-dnd-metadata", 2, enabled = true, code = "101 refreshed"),
            synchronized = true
        )
        receiver.handle(roomUpdatedEvent("event-dnd-off", 3, enabled = false), synchronized = true)

        assertEquals(NotificationReceiverCore.IgnoreReason.DUPLICATE, duplicate.reason)
        assertEquals(NotificationReceiverCore.IgnoreReason.OUT_OF_ORDER, older.reason)
        assertEquals(NotificationReceiverCore.IgnoreReason.DO_NOT_DISTURB_STATE_UNCHANGED, metadataOnly.reason)
        assertEquals(listOf(true, false), sink.doNotDisturbDelivered.map(DoNotDisturbNotification::enabled))
        assertEquals(3L, cursor.lastSeenEventSequence)
    }

    @Test
    fun roomDoNotDisturbChangesDoNotAlertWhenTheSnapshotBaselineIsUnknown() = runTest {
        val cursor = TestCursor()
        val sink = RecordingSink()
        val receiver = NotificationReceiverCore("area-a", cursor, sink)

        val result = receiver.handle(roomUpdatedEvent("event-dnd-unknown", 1, enabled = true), synchronized = true)

        assertEquals(NotificationReceiverCore.IgnoreReason.DO_NOT_DISTURB_BASELINE_UNKNOWN, result.reason)
        assertTrue(sink.doNotDisturbDelivered.isEmpty())
        assertEquals(1L, cursor.lastSeenEventSequence)
    }

    @Test
    fun doNotDisturbSinkFailureDoesNotAdvanceStateAndRetriesTheDurableEvent() = runTest {
        val cursor = TestCursor()
        val sink = RecordingSink(failuresRemaining = 1)
        val receiver = NotificationReceiverCore(
            "area-a",
            cursor,
            sink,
            initialActiveDoNotDisturbRoomIds = emptySet()
        )
        val activation = roomUpdatedEvent("event-dnd-retry", 1, enabled = true)

        assertSuspendingFailure { receiver.handle(activation, synchronized = true) }
        assertEquals(0L, cursor.lastSeenEventSequence)
        assertTrue(sink.doNotDisturbDelivered.isEmpty())
        assertSuspendingFailure {
            receiver.handle(roomUpdatedEvent("event-dnd-later", 2, enabled = true), synchronized = true)
        }

        receiver.handle(activation, synchronized = true)
        receiver.handle(roomUpdatedEvent("event-dnd-later", 2, enabled = true), synchronized = true)

        assertEquals(listOf(true), sink.doNotDisturbDelivered.map(DoNotDisturbNotification::enabled))
        assertEquals(2L, cursor.lastSeenEventSequence)
    }

    private suspend fun assertSuspendingFailure(block: suspend () -> Unit) {
        try {
            block()
        } catch (error: IllegalStateException) {
            return
        }
        throw AssertionError("Expected the suspending operation to fail")
    }

    @Test
    fun pendingNotificationExposesAnAndroidStartActionWithMutationMetadata() {
        val notification = RequestNotification(
            eventName = "request.created",
            eventId = "event-9",
            eventSequence = 9,
            occurredAt = "2026-09-19T00:00:00Z",
            request = requestSnapshot("area-a")
        )

        val content = NotificationMapper.map(notification)

        assertEquals(NotificationAction.START_REQUEST, content.action)
        assertEquals("event-9", content.metadata["eventId"])
        assertEquals("request-1", content.metadata["requestId"])
        assertEquals("1", content.metadata["expectedVersion"])
        assertTrue(content.metadata["idempotencyKey"]?.startsWith("notification-") == true)
        assertEquals("Habitación 101 · Fresh towels", content.title)
    }

    @Test
    fun requestNotificationsUseTheAudibleChannelVersion() {
        val notification = RequestNotification(
            eventName = "request.created",
            eventId = "event-audible-channel",
            eventSequence = 11,
            occurredAt = "2026-09-19T00:00:00Z",
            request = requestSnapshot("area-a")
        )

        assertEquals("hotel-alert-requests-v4", NotificationMapper.map(notification).channelId)
    }

    @Test
    fun completedNotificationOnlyOpensDiagnostics() {
        val notification = RequestNotification(
            eventName = "request.updated",
            eventId = "event-10",
            eventSequence = 10,
            occurredAt = "2026-09-19T00:00:00Z",
            request = requestSnapshot("area-a").copy(status = "COMPLETED")
        )

        assertEquals(NotificationAction.OPEN_DIAGNOSTICS, NotificationMapper.map(notification).action)
    }

    @Test
    fun statusUpdatesAdvanceTheCursorWithoutCreatingAnOperatorAlert() = runTest {
        val cursor = TestCursor()
        val sink = RecordingSink()
        val receiver = NotificationReceiverCore("area-a", cursor, sink)
        val updated = requestCreatedEvent("event-updated", 12, "area-a").apply {
            put("name", "request.updated")
            getJSONObject("payload").remove("alert")
            getJSONObject("payload").put(
                "transition",
                JSONObject()
                    .put("from", "PENDING")
                    .put("to", "IN_PROGRESS")
                    .put("actorType", "DEVICE")
                    .put("actorId", "area-device")
            )
        }

        val result = receiver.handle(updated, synchronized = true)

        assertEquals(NotificationReceiverCore.HandleOutcome.DELIVERED, result.outcome)
        assertEquals(12L, cursor.lastSeenEventSequence)
        assertTrue(sink.delivered.isEmpty())
    }

    @Test
    fun requestPopupContainsRoomServiceAreaDetailsAndStartAction() {
        val notification = RequestNotification(
            eventName = "request.created",
            eventId = "event-popup",
            eventSequence = 13,
            occurredAt = "2026-09-19T00:00:00Z",
            request = requestSnapshot("area-a")
        )

        val content = NotificationMapper.map(notification)

        assertEquals(NotificationAction.START_REQUEST, content.action)
        assertEquals("Habitación 101 · Fresh towels", content.title)
        assertEquals("Área: Housekeeping", content.text)
        assertFalse(content.title.contains("New request"))
        assertEquals(
            "Habitación: 101\nServicio: Fresh towels\nÁrea: Housekeeping",
            content.expandedText
        )
        assertTrue(content.expandedText.contains("Habitación: 101"))
        assertTrue(content.expandedText.contains("Fresh towels"))
        assertTrue(content.expandedText.contains("Housekeeping"))
    }

    @Test
    fun operatorAlertPolicySuppressesAlertsOnlyWhileTheConsoleIsForeground() {
        val notification = RequestNotification(
            eventName = "request.created",
            eventId = "event-foreground",
            eventSequence = 14,
            occurredAt = "2026-09-19T00:00:00Z",
            request = requestSnapshot("area-a")
        )

        assertTrue(NotificationMapper.shouldPostOperatorAlert(notification, appInForeground = false))
        assertFalse(NotificationMapper.shouldPostOperatorAlert(notification, appInForeground = true))
        assertFalse(NotificationMapper.shouldPostOperatorAlert(notification.copy(eventName = "request.updated"), appInForeground = false))
    }

    private class TestCursor(initial: Long = 0) : DurableCursorStore {
        override var lastSeenEventSequence: Long = initial
            private set

        override suspend fun advanceTo(eventSequence: Long) {
            check(eventSequence >= lastSeenEventSequence)
            lastSeenEventSequence = eventSequence
        }
    }

    private class RecordingSink(var failuresRemaining: Int = 0) : NotificationSink {
        val delivered = mutableListOf<RequestNotification>()
        val doNotDisturbDelivered = mutableListOf<DoNotDisturbNotification>()

        override suspend fun deliver(notification: RequestNotification) {
            if (failuresRemaining > 0) {
                failuresRemaining -= 1
                throw IllegalStateException("sink unavailable")
            }
            delivered += notification
        }

        override suspend fun deliver(notification: DoNotDisturbNotification) {
            if (failuresRemaining > 0) {
                failuresRemaining -= 1
                throw IllegalStateException("sink unavailable")
            }
            doNotDisturbDelivered += notification
        }
    }
}

internal fun roomUpdatedEvent(
    eventId: String,
    sequence: Long,
    enabled: Boolean,
    code: String = "101"
): JSONObject = JSONObject()
    .put("schemaVersion", 1)
    .put("eventId", eventId)
    .put("eventSequence", sequence)
    .put("name", "room.updated")
    .put("occurredAt", "2026-09-19T00:00:00Z")
    .put("aggregateType", "ROOM")
    .put("aggregateId", "room-1")
    .put("aggregateVersion", sequence)
    .put(
        "payload",
        JSONObject().put(
            "room",
            JSONObject()
                .put("id", "room-1")
                .put("code", code)
                .put("displayName", "Room 101")
                .put("doNotDisturb", enabled)
        )
    )

internal fun requestCreatedEvent(
    eventId: String,
    sequence: Long,
    areaId: String,
    aggregateVersion: Long = 1L
): JSONObject = JSONObject()
    .put("schemaVersion", 1)
    .put("eventId", eventId)
    .put("eventSequence", sequence)
    .put("name", "request.created")
    .put("occurredAt", "2026-09-19T00:00:00Z")
    .put("aggregateType", "REQUEST")
    .put("aggregateId", "request-1")
    .put("aggregateVersion", aggregateVersion)
    .put(
        "payload",
        JSONObject()
            .put("alert", JSONObject().put("repeatUntil", "ACCEPTED"))
            .put("request", requestSnapshotJson(areaId, aggregateVersion))
    )

internal fun requestSnapshot(areaId: String) = com.hotelalert.notificationreceiver.protocol.RequestSnapshot(
    id = "request-1",
    roomId = "room-1",
    roomCode = "101",
    roomDisplayName = "Room 101",
    serviceId = "service-1",
    serviceCode = "towels",
    serviceDisplayName = "Fresh towels",
    responsibleAreaId = areaId,
    responsibleAreaCode = "housekeeping",
    responsibleAreaDisplayName = "Housekeeping",
    status = "PENDING",
    version = 1
)

private fun requestSnapshotJson(areaId: String, version: Long): JSONObject = JSONObject()
    .put("id", "request-1")
    .put("roomId", "room-1")
    .put("serviceId", "service-1")
    .put("responsibleAreaId", areaId)
    .put("status", "PENDING")
    .put("version", version)
    .put("createdAt", "2026-09-19T00:00:00Z")
    .put("updatedAt", "2026-09-19T00:00:00Z")
    .put("acceptedAt", JSONObject.NULL)
    .put("inProgressAt", JSONObject.NULL)
    .put("completedAt", JSONObject.NULL)
    .put("room", JSONObject().put("id", "room-1").put("code", "101").put("displayName", "Room 101").put("doNotDisturb", false))
    .put("service", JSONObject().put("id", "service-1").put("code", "towels").put("displayName", "Fresh towels").put("iconKey", "towels"))
    .put("responsibleArea", JSONObject().put("id", areaId).put("code", "housekeeping").put("displayName", "Housekeeping"))
