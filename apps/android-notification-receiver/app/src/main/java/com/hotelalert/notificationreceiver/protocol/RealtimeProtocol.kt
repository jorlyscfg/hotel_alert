package com.hotelalert.notificationreceiver.protocol

import org.json.JSONObject

data class ReceiverConfiguration(
    val serverOrigin: String,
    val deviceId: String,
    val clientInstanceId: String,
    val clientVersion: String
)

interface ReceiverConfigurationStore {
    fun read(): ReceiverConfiguration?

    fun write(configuration: ReceiverConfiguration)

    /** Returns null when upgrading a version that did not persist receiver intent. */
    fun readReceiverRunIntent(): Boolean? = null

    fun writeReceiverRunIntent(enabled: Boolean) = Unit

    fun clearReceiverRunIntent() = Unit

    /** Clears device assignment fields while retaining the configured server origin. */
    fun clearDeviceAssignment() = Unit

    fun clear() = Unit
}

enum class ReceiverState {
    IDLE,
    FETCHING_SNAPSHOT,
    CONNECTING,
    CONNECTED,
    SYNCHRONIZING,
    SYNCHRONIZED,
    AUTH_FAILED,
    ERROR,
    STOPPED
}

data class DeviceSessionSnapshot(
    val deviceId: String,
    val areaId: String,
    val areaDisplayName: String,
    val currentEventSequence: Long,
    val deviceConfigVersion: Long,
    val heartbeatIntervalMs: Long,
    val payloadJson: String? = null,
    /** Null means this snapshot version cannot establish authoritative DND state. */
    val activeDoNotDisturbRoomIds: Set<String>? = null
)

interface DeviceSnapshotClient {
    suspend fun fetch(serverOrigin: String, deviceId: String, token: String): DeviceSessionSnapshot
}

class DeviceSnapshotException(
    val statusCode: Int,
    val errorCode: String?
) : IllegalStateException("The device session request failed with HTTP $statusCode.")

interface RealtimeSocket {
    val connected: Boolean

    fun on(eventName: String, listener: (Any?) -> Unit): RealtimeSocket

    fun off(eventName: String, listener: (Any?) -> Unit): RealtimeSocket

    fun updateAuth(auth: JSONObject): RealtimeSocket

    fun emit(eventName: String, payload: JSONObject, acknowledgement: (JSONObject?) -> Unit): RealtimeSocket

    fun connect(): RealtimeSocket

    fun disconnect(): RealtimeSocket

    fun disableReconnection()
}

interface RealtimeSocketFactory {
    fun create(serverOrigin: String, auth: JSONObject): RealtimeSocket
}

data class ConnectionReady(
    val serverTime: String,
    val currentEventSequence: Long,
    val sync: SyncMode
)

enum class SyncMode {
    REPLAY_AVAILABLE,
    FULL_SNAPSHOT_REQUIRED,
    UP_TO_DATE
}

data class SyncRequired(
    val reason: SyncRequiredReason,
    val currentEventSequence: Long
)

enum class SyncRequiredReason {
    EVENT_GAP,
    ASSIGNMENT_CHANGED,
    SERVER_RESTART,
    DEVICE_CONFIG_MISMATCH
}

data class TransportAck(
    val ok: Boolean,
    val eventId: String? = null,
    val errorCode: String? = null,
    val sync: SyncMode? = null
)

fun buildRealtimeAuth(
    configuration: ReceiverConfiguration,
    deviceToken: String,
    lastSeenEventSequence: Long,
    deviceConfigVersion: Long?
): JSONObject = JSONObject()
    .put("deviceId", configuration.deviceId)
    .put("deviceToken", deviceToken)
    .put("clientInstanceId", configuration.clientInstanceId)
    .put("clientVersion", configuration.clientVersion)
    .put("lastSeenEventSequence", lastSeenEventSequence)
    .apply {
        if (deviceConfigVersion != null) put("deviceConfigVersion", deviceConfigVersion)
    }

fun parseConnectionReady(value: Any?): ConnectionReady? {
    val json = value as? JSONObject ?: return null
    val serverTime = json.requiredString("serverTime") ?: return null
    val currentEventSequence = json.nonNegativeLong("currentEventSequence") ?: return null
    val sync = when (json.requiredString("sync")) {
        "REPLAY_AVAILABLE" -> SyncMode.REPLAY_AVAILABLE
        "FULL_SNAPSHOT_REQUIRED" -> SyncMode.FULL_SNAPSHOT_REQUIRED
        "UP_TO_DATE" -> SyncMode.UP_TO_DATE
        else -> return null
    }
    return ConnectionReady(serverTime, currentEventSequence, sync)
}

fun parseSyncRequired(value: Any?): SyncRequired? {
    val json = value as? JSONObject ?: return null
    val reason = when (json.requiredString("reason")) {
        "EVENT_GAP" -> SyncRequiredReason.EVENT_GAP
        "ASSIGNMENT_CHANGED" -> SyncRequiredReason.ASSIGNMENT_CHANGED
        "SERVER_RESTART" -> SyncRequiredReason.SERVER_RESTART
        "DEVICE_CONFIG_MISMATCH" -> SyncRequiredReason.DEVICE_CONFIG_MISMATCH
        else -> return null
    }
    val currentEventSequence = json.nonNegativeLong("currentEventSequence") ?: return null
    return SyncRequired(reason, currentEventSequence)
}

fun parseTransportAck(value: JSONObject?): TransportAck {
    if (value == null) return TransportAck(ok = false, errorCode = "INTERNAL_ERROR")
    val sync = when (value.optString("sync")) {
        "REPLAY_AVAILABLE" -> SyncMode.REPLAY_AVAILABLE
        "FULL_SNAPSHOT_REQUIRED" -> SyncMode.FULL_SNAPSHOT_REQUIRED
        "UP_TO_DATE" -> SyncMode.UP_TO_DATE
        else -> null
    }
    return TransportAck(
        ok = value.optBoolean("ok", false),
        eventId = value.optString("eventId").takeIf { it.isNotEmpty() },
        errorCode = value.optString("errorCode").takeIf { it.isNotEmpty() },
        sync = sync
    )
}

fun authenticationFailureCode(value: Any?): String? {
    val code = when (value) {
        is JSONObject -> sequenceOf("errorCode", "code", "name")
            .map { value.optString(it) }
            .firstOrNull { it.isNotEmpty() }
        is DeviceSnapshotException -> value.errorCode
        is Throwable -> value.message?.let(::safeErrorCodeFromMessage)
        else -> null
    }
    return code?.takeIf { it in AUTH_FAILURE_CODES }
}

fun safeErrorCode(value: Any?): String = when (value) {
    is JSONObject -> sequenceOf("errorCode", "code", "name")
        .map { value.optString(it) }
        .firstOrNull { it.isNotEmpty() }
        ?: "UNKNOWN_ERROR"
    is DeviceSnapshotException -> value.errorCode ?: "HTTP_${value.statusCode}"
    is Throwable -> safeErrorCodeFromMessage(value.message ?: "") ?: value::class.java.simpleName
    else -> "UNKNOWN_ERROR"
}

private fun safeErrorCodeFromMessage(message: String): String? = AUTH_FAILURE_CODES.firstOrNull { message.contains(it) }

private fun JSONObject.requiredString(key: String): String? {
    val value = opt(key)
    return if (value is String && value.isNotEmpty()) value else null
}

private fun JSONObject.nonNegativeLong(key: String): Long? {
    val value = opt(key)
    if (value !is Number || value.toDouble() != value.toLong().toDouble()) return null
    return value.toLong().takeIf { it >= 0 }
}

private val AUTH_FAILURE_CODES = setOf(
    "AUTH_REQUIRED",
    "AUTH_INVALID",
    "AUTH_AMBIGUOUS_CREDENTIALS",
    "DEVICE_INACTIVE",
    "DEVICE_TOKEN_REVOKED",
    "TOKEN_ROTATION_EXPIRED",
    "TOKEN_ROTATION_REQUIRED",
    "FORBIDDEN_ASSIGNMENT"
)
