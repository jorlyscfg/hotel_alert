package com.hotelalert.notificationreceiver.protocol

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

data class DurableRealtimeEvent(
    val schemaVersion: Int,
    val eventId: String,
    val eventSequence: Long,
    val name: String,
    val occurredAt: String,
    val aggregateType: String,
    val aggregateId: String,
    val aggregateVersion: Long?,
    val payload: JSONObject
)

data class RequestSnapshot(
    val id: String,
    val roomId: String,
    val roomCode: String,
    val roomDisplayName: String,
    val serviceId: String,
    val serviceCode: String,
    val serviceDisplayName: String,
    val responsibleAreaId: String,
    val responsibleAreaCode: String,
    val responsibleAreaDisplayName: String,
    val status: String,
    val version: Long,
    /** Present for requests created by a ROOM device; omitted for older events. */
    val createdByDeviceId: String? = null
)

data class RequestNotification(
    val eventName: String,
    val eventId: String,
    val eventSequence: Long,
    val occurredAt: String,
    val request: RequestSnapshot
)

data class DoNotDisturbNotification(
    val eventName: String,
    val eventId: String,
    val eventSequence: Long,
    val occurredAt: String,
    val roomId: String,
    val roomCode: String,
    val roomDisplayName: String,
    val enabled: Boolean
)

interface NotificationSink {
    suspend fun deliver(notification: RequestNotification)

    suspend fun deliver(notification: DoNotDisturbNotification) = Unit
}

interface DurableCursorStore {
    val lastSeenEventSequence: Long

    suspend fun advanceTo(eventSequence: Long)

    suspend fun clear() = Unit
}

class NotificationReceiverCore(
    private val assignedAreaId: String,
    private val cursor: DurableCursorStore,
    internal val sink: NotificationSink,
    initialActiveDoNotDisturbRoomIds: Set<String>? = null
) {
    enum class HandleOutcome {
        DEFERRED,
        IGNORED,
        DELIVERED
    }

    enum class IgnoreReason {
        UNSUPPORTED_EVENT,
        NOT_SYNCHRONIZED,
        UNASSIGNED_AREA,
        DUPLICATE,
        OUT_OF_ORDER,
        OLDER_AGGREGATE_VERSION,
        DO_NOT_DISTURB_BASELINE_UNKNOWN,
        DO_NOT_DISTURB_STATE_UNCHANGED
    }

    sealed interface HandleResult {
        val outcome: HandleOutcome
        val reason: IgnoreReason?
        val cursorSequence: Long
        val cursorAdvanced: Boolean
    }

    data class DeferredResult(
        override val cursorSequence: Long
    ) : HandleResult {
        override val outcome = HandleOutcome.DEFERRED
        override val reason = IgnoreReason.NOT_SYNCHRONIZED
        override val cursorAdvanced = false
    }

    data class IgnoredResult(
        override val reason: IgnoreReason,
        override val cursorSequence: Long,
        override val cursorAdvanced: Boolean
    ) : HandleResult {
        override val outcome = HandleOutcome.IGNORED
    }

    data class DeliveredResult(
        val notification: RequestNotification,
        override val cursorSequence: Long
    ) : HandleResult {
        override val outcome = HandleOutcome.DELIVERED
        override val reason: IgnoreReason? = null
        override val cursorAdvanced = true
    }

    data class DoNotDisturbDeliveredResult(
        val notification: DoNotDisturbNotification,
        override val cursorSequence: Long
    ) : HandleResult {
        override val outcome = HandleOutcome.DELIVERED
        override val reason: IgnoreReason? = null
        override val cursorAdvanced = true
    }

    private data class FailedEvent(
        val rawEvent: JSONObject,
        val eventId: String?,
        val error: Throwable
    )

    private val mutex = Mutex()
    private val seenEventIds = LinkedHashSet<String>()
    private val aggregateVersions = LinkedHashMap<String, Long>()
    private var activeDoNotDisturbRoomIds = initialActiveDoNotDisturbRoomIds?.toMutableSet()
    private var lastSeenEventSequence = cursor.lastSeenEventSequence
    private var failedEvent: FailedEvent? = null

    internal fun activeDoNotDisturbRoomIdsSnapshot(): Set<String>? = activeDoNotDisturbRoomIds?.toSet()

    suspend fun handle(rawEvent: JSONObject, synchronized: Boolean): HandleResult = mutex.withLock {
        val event = parseDurableRealtimeEvent(rawEvent)
        val failure = failedEvent
        if (failure != null) {
            val isRetry = rawEvent === failure.rawEvent
                || event?.eventId != null && event.eventId == failure.eventId
            if (!isRetry) throw failure.error
            failedEvent = null
        }

        try {
            process(event, synchronized)
        } catch (error: Throwable) {
            failedEvent = FailedEvent(rawEvent, event?.eventId, error)
            throw error
        }
    }

    private suspend fun process(event: DurableRealtimeEvent?, synchronized: Boolean): HandleResult {
        if (event == null) return ignored(IgnoreReason.UNSUPPORTED_EVENT, false)
        if (!synchronized) return DeferredResult(lastSeenEventSequence)
        if (seenEventIds.contains(event.eventId)) return ignored(IgnoreReason.DUPLICATE, false)
        if (event.eventSequence <= lastSeenEventSequence) return ignored(IgnoreReason.OUT_OF_ORDER, false)

        val doNotDisturbNotification = parseDoNotDisturbNotification(event)
        if (doNotDisturbNotification != null) {
            return processDoNotDisturbEvent(event, doNotDisturbNotification)
        }

        val requestNotification = parseRequestNotification(event)
        val isRecognizedRequestName = event.aggregateType == "REQUEST"
            && (event.name == "request.created" || event.name == "request.updated")
        if (requestNotification == null) {
            if (isRecognizedRequestName) return ignored(IgnoreReason.UNSUPPORTED_EVENT, false)
            advanceCursor(event.eventSequence)
            rememberEvent(event.eventId)
            return ignored(IgnoreReason.UNSUPPORTED_EVENT, true)
        }

        val aggregateKey = "REQUEST:${event.aggregateId}"
        val aggregateVersion = event.aggregateVersion ?: requestNotification.request.version
        val previousVersion = aggregateVersions[aggregateKey]
        val outsideAssignedArea = requestNotification.request.responsibleAreaId != assignedAreaId
        val olderAggregateVersion = previousVersion != null && aggregateVersion <= previousVersion
        if (outsideAssignedArea || olderAggregateVersion) {
            advanceCursor(event.eventSequence)
            rememberAcceptedEvent(event.eventId, aggregateKey, aggregateVersion)
            return ignored(
                if (outsideAssignedArea) IgnoreReason.UNASSIGNED_AREA else IgnoreReason.OLDER_AGGREGATE_VERSION,
                true
            )
        }

        // Realtime updates are still consumed, acknowledged, and used to refresh
        // the native snapshot, but they must never create a new operator alert.
        // A request.created event is the server's ROOM-device request boundary.
        if (requestNotification.eventName == "request.created") {
            sink.deliver(requestNotification)
        }
        advanceCursor(event.eventSequence)
        rememberAcceptedEvent(event.eventId, aggregateKey, aggregateVersion)
        return DeliveredResult(requestNotification, lastSeenEventSequence)
    }

    private suspend fun processDoNotDisturbEvent(
        event: DurableRealtimeEvent,
        notification: DoNotDisturbNotification
    ): HandleResult {
        val knownRoomIds = activeDoNotDisturbRoomIds
        if (knownRoomIds == null) {
            advanceCursor(event.eventSequence)
            rememberEvent(event.eventId)
            return ignored(IgnoreReason.DO_NOT_DISTURB_BASELINE_UNKNOWN, true)
        }

        val wasEnabled = notification.roomId in knownRoomIds
        val changed = wasEnabled != notification.enabled
        if (changed) sink.deliver(notification)

        advanceCursor(event.eventSequence)
        rememberEvent(event.eventId)
        if (changed) {
            if (notification.enabled) knownRoomIds += notification.roomId
            else knownRoomIds -= notification.roomId
            return DoNotDisturbDeliveredResult(notification, lastSeenEventSequence)
        }
        return ignored(IgnoreReason.DO_NOT_DISTURB_STATE_UNCHANGED, true)
    }

    private suspend fun advanceCursor(eventSequence: Long) {
        cursor.advanceTo(eventSequence)
        lastSeenEventSequence = eventSequence
    }

    private fun rememberAcceptedEvent(eventId: String, aggregateKey: String, aggregateVersion: Long) {
        seenEventIds += eventId
        val previousVersion = aggregateVersions[aggregateKey]
        if (previousVersion == null || aggregateVersion > previousVersion) {
            aggregateVersions[aggregateKey] = aggregateVersion
        }
        pruneState()
    }

    private fun rememberEvent(eventId: String) {
        seenEventIds += eventId
        pruneState()
    }

    private fun pruneState() {
        while (seenEventIds.size > MAX_TRACKED_EVENT_IDS) {
            val oldest = seenEventIds.firstOrNull() ?: break
            seenEventIds.remove(oldest)
        }
        while (aggregateVersions.size > MAX_TRACKED_AGGREGATES) {
            val oldest = aggregateVersions.keys.firstOrNull() ?: break
            aggregateVersions.remove(oldest)
        }
    }

    private fun ignored(reason: IgnoreReason, cursorAdvanced: Boolean): IgnoredResult = IgnoredResult(
        reason = reason,
        cursorSequence = lastSeenEventSequence,
        cursorAdvanced = cursorAdvanced
    )

    companion object {
        private const val MAX_TRACKED_EVENT_IDS = 2_048
        private const val MAX_TRACKED_AGGREGATES = 2_048
    }
}

private fun parseDoNotDisturbNotification(event: DurableRealtimeEvent): DoNotDisturbNotification? {
    if (event.aggregateType != "ROOM" || event.name != "room.updated") return null
    val room = event.payload.optJSONObject("room") ?: return null
    val roomId = room.requiredString("id") ?: return null
    if (roomId != event.aggregateId) return null
    val roomCode = room.requiredString("code") ?: return null
    val roomDisplayName = room.requiredString("displayName") ?: return null
    val enabled = room.opt("doNotDisturb") as? Boolean ?: return null
    return DoNotDisturbNotification(
        eventName = event.name,
        eventId = event.eventId,
        eventSequence = event.eventSequence,
        occurredAt = event.occurredAt,
        roomId = roomId,
        roomCode = roomCode,
        roomDisplayName = roomDisplayName,
        enabled = enabled
    )
}

fun parseDurableRealtimeEvent(value: JSONObject): DurableRealtimeEvent? {
    val schemaVersion = value.requiredInt("schemaVersion") ?: return null
    val eventId = value.requiredString("eventId") ?: return null
    val eventSequence = value.nonNegativeLong("eventSequence") ?: return null
    val name = value.requiredString("name") ?: return null
    val occurredAt = value.requiredString("occurredAt") ?: return null
    val aggregateType = value.requiredString("aggregateType") ?: return null
    if (schemaVersion != 1 || aggregateType !in DURABLE_AGGREGATE_TYPES) return null
    val aggregateId = value.requiredString("aggregateId") ?: return null
    val payload = value.optJSONObject("payload") ?: return null
    val aggregateVersion = value.optionalNonNegativeLong("aggregateVersion") ?: if (value.has("aggregateVersion")) return null else null
    return DurableRealtimeEvent(
        schemaVersion = schemaVersion,
        eventId = eventId,
        eventSequence = eventSequence,
        name = name,
        occurredAt = occurredAt,
        aggregateType = aggregateType,
        aggregateId = aggregateId,
        aggregateVersion = aggregateVersion,
        payload = payload
    )
}

private fun parseRequestNotification(event: DurableRealtimeEvent): RequestNotification? {
    if (event.aggregateType != "REQUEST") return null
    val requestJson = event.payload.optJSONObject("request") ?: return null
    val request = parseRequestSnapshot(requestJson) ?: return null
    when (event.name) {
        "request.created" -> {
            val alert = event.payload.optJSONObject("alert") ?: return null
            if (alert.requiredString("repeatUntil") !in setOf("ACCEPTED", "IN_PROGRESS")) return null
        }

        "request.updated" -> {
            val transition = event.payload.optJSONObject("transition") ?: return null
            if (transition.requiredString("from") !in REQUEST_STATUSES
                || transition.requiredString("to") !in REQUEST_STATUSES
                || transition.requiredString("actorType") !in ACTOR_TYPES
                || !transition.optionalStringOrNull("actorId")) {
                return null
            }
        }

        else -> return null
    }
    return RequestNotification(
        eventName = event.name,
        eventId = event.eventId,
        eventSequence = event.eventSequence,
        occurredAt = event.occurredAt,
        request = request
    )
}

private fun parseRequestSnapshot(value: JSONObject): RequestSnapshot? {
    val id = value.requiredString("id") ?: return null
    val roomId = value.requiredString("roomId") ?: return null
    val serviceId = value.requiredString("serviceId") ?: return null
    val responsibleAreaId = value.requiredString("responsibleAreaId") ?: return null
    val status = value.requiredString("status") ?: return null
    val version = value.nonNegativeLong("version") ?: return null
    val createdAt = value.requiredString("createdAt") ?: return null
    val updatedAt = value.requiredString("updatedAt") ?: return null
    if (status !in REQUEST_STATUSES || createdAt.isEmpty() || updatedAt.isEmpty()) return null
    if (!value.optionalStringOrNull("acceptedAt")
        || !value.optionalStringOrNull("inProgressAt")
        || !value.optionalStringOrNull("completedAt")) {
        return null
    }
    val room = value.optJSONObject("room") ?: return null
    val service = value.optJSONObject("service") ?: return null
    val area = value.optJSONObject("responsibleArea") ?: return null
    val roomCode = room.requiredString("code") ?: return null
    val roomDisplayName = room.requiredString("displayName") ?: return null
    val serviceCode = service.requiredString("code") ?: return null
    val serviceDisplayName = service.requiredString("displayName") ?: return null
    val areaCode = area.requiredString("code") ?: return null
    val areaDisplayName = area.requiredString("displayName") ?: return null
    if (!room.optionalBoolean("doNotDisturb") || !service.optionalStringOrNull("iconKey")) return null
    return RequestSnapshot(
        id = id,
        roomId = roomId,
        roomCode = roomCode,
        roomDisplayName = roomDisplayName,
        serviceId = serviceId,
        serviceCode = serviceCode,
        serviceDisplayName = serviceDisplayName,
        responsibleAreaId = responsibleAreaId,
        responsibleAreaCode = areaCode,
        responsibleAreaDisplayName = areaDisplayName,
        status = status,
        version = version,
        createdByDeviceId = value.optionalStringOrNullValue("createdByDeviceId")
    )
}

private fun JSONObject.requiredString(key: String): String? {
    val value = opt(key)
    return if (value is String && value.isNotEmpty()) value else null
}

private fun JSONObject.requiredInt(key: String): Int? {
    val value = opt(key)
    return if (value is Number && value.toDouble() == value.toInt().toDouble()) value.toInt() else null
}

private fun JSONObject.nonNegativeLong(key: String): Long? {
    val value = opt(key)
    if (value !is Number || value.toDouble() != value.toLong().toDouble()) return null
    return value.toLong().takeIf { it >= 0 }
}

private fun JSONObject.optionalNonNegativeLong(key: String): Long? {
    if (!has(key) || isNull(key)) return null
    return nonNegativeLong(key)
}

private fun JSONObject.optionalStringOrNull(key: String): Boolean {
    if (!has(key) || isNull(key)) return true
    return opt(key) is String
}

private fun JSONObject.optionalStringOrNullValue(key: String): String? {
    if (!has(key) || isNull(key)) return null
    return (opt(key) as? String)?.takeIf { it.isNotEmpty() }
}

private fun JSONObject.optionalBoolean(key: String): Boolean {
    if (!has(key)) return false
    return opt(key) is Boolean
}

private val DURABLE_AGGREGATE_TYPES = setOf("REQUEST", "DEVICE", "ROOM", "AREA", "SERVICE", "SYSTEM")
private val REQUEST_STATUSES = setOf("PENDING", "ACCEPTED", "IN_PROGRESS", "COMPLETED")
private val ACTOR_TYPES = setOf("ADMIN", "DEVICE", "SYSTEM")
