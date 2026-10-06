package com.hotelalert.notificationreceiver.network

import com.hotelalert.notificationreceiver.protocol.RoomPresenceClient
import com.hotelalert.notificationreceiver.protocol.RoomPresenceException
import com.hotelalert.notificationreceiver.protocol.RoomPresenceSnapshot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.ParsePosition
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

class HttpRoomPresenceClient internal constructor(
    private val openConnection: (URL) -> HttpURLConnection = { it.openConnection() as HttpURLConnection }
) : RoomPresenceClient {
    override suspend fun fetchSession(serverOrigin: String, deviceId: String, token: String): RoomPresenceSnapshot =
        withContext(Dispatchers.IO) {
            val response = request(serverOrigin, "/api/v1/device/session", "GET", token)
            val envelope = runCatching { JSONObject(response) }
                .getOrElse { throw IllegalStateException("The ROOM session response is invalid.", it) }
            if (envelope.optString("requestId").isBlank()) {
                throw IllegalStateException("The ROOM session response is missing its request reference.")
            }
            val data = envelope.optJSONObject("data")
                ?: throw IllegalStateException("The ROOM session response is missing its data.")
            parseRoomSnapshot(data, deviceId)
        }

    override suspend fun sendHeartbeat(
        serverOrigin: String,
        deviceId: String,
        token: String,
        clientVersion: String
    ) = withContext(Dispatchers.IO) {
        request(
            serverOrigin,
            "/api/v1/device/heartbeat",
            "POST",
            token,
            JSONObject().put("clientVersion", clientVersion).put("socketConnected", false).toString()
        )
        Unit
    }

    private fun request(
        serverOrigin: String,
        path: String,
        method: String,
        token: String,
        body: String? = null
    ): String {
        val connection = openConnection(URL("${serverOrigin.trimEnd('/')}$path")).apply {
            instanceFollowRedirects = false
            requestMethod = method
            connectTimeout = REQUEST_TIMEOUT_MS
            readTimeout = REQUEST_TIMEOUT_MS
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        try {
            if (body != null) connection.outputStream.bufferedWriter(Charsets.UTF_8).use { it.write(body) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val response = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (status !in 200..299) throw RoomPresenceException(
                status,
                parseErrorCode(response),
                if (status == 429) {
                    parseRoomPresenceRetryAfterMs(connection.getHeaderField("Retry-After"))
                } else {
                    null
                }
            )
            return response
        } finally {
            connection.disconnect()
        }
    }

    private fun parseRoomSnapshot(data: JSONObject, expectedDeviceId: String): RoomPresenceSnapshot {
        val device = data.optJSONObject("device")
            ?: throw IllegalStateException("The ROOM session has no device record.")
        val config = data.optJSONObject("config")
            ?: throw IllegalStateException("The ROOM session has no configuration.")
        val deviceId = device.optString("id")
        if (deviceId.isBlank()) throw IllegalStateException("The ROOM session has no device ID.")
        if (deviceId != expectedDeviceId) throw RoomPresenceException(403, "FORBIDDEN_ASSIGNMENT")

        val assignmentMode = device.optString("assignmentMode")
        val roomId = device.optString("roomId").takeIf { it.isNotBlank() }
        if (!device.optBoolean("active", false)) throw RoomPresenceException(403, "DEVICE_INACTIVE")
        if (assignmentMode != "ROOM" || roomId == null || config.optString("mode") != "ROOM") {
            throw RoomPresenceException(403, "FORBIDDEN_ASSIGNMENT")
        }
        val configuredRoomId = config.optJSONObject("room")?.optString("id")
        if (configuredRoomId != roomId) throw RoomPresenceException(403, "FORBIDDEN_ASSIGNMENT")
        val interval = config.opt("heartbeatIntervalMs") as? Number
            ?: throw IllegalStateException("The ROOM session heartbeat interval is invalid.")
        val intervalMs = interval.toLong()
        if (intervalMs <= 0 || interval.toDouble() != intervalMs.toDouble()) {
            throw IllegalStateException("The ROOM session heartbeat interval is invalid.")
        }
        return RoomPresenceSnapshot(deviceId, assignmentMode, true, roomId, intervalMs)
    }

    private fun parseErrorCode(body: String): String? = runCatching {
        JSONObject(body).optJSONObject("error")?.optString("code")
            ?.takeIf { it.matches(SAFE_ERROR_CODE_PATTERN) }
    }.getOrNull()

    companion object {
        private const val REQUEST_TIMEOUT_MS = 10_000
        private val SAFE_ERROR_CODE_PATTERN = Regex("[A-Z][A-Z0-9_]{0,63}")
    }
}

internal fun parseRoomPresenceRetryAfterMs(value: String?, nowMillis: Long = System.currentTimeMillis()): Long? {
    val header = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val delayMs = if (DELTA_SECONDS_PATTERN.matches(header)) {
        val seconds = header.toLongOrNull() ?: return MAX_SERVER_RETRY_DELAY_MS
        seconds.coerceAtMost(MAX_SERVER_RETRY_DELAY_MS / 1_000L) * 1_000L
    } else {
        val parser = SimpleDateFormat(HTTP_DATE_PATTERN, Locale.US).apply {
            isLenient = false
            timeZone = TimeZone.getTimeZone("GMT")
        }
        val position = ParsePosition(0)
        val retryAt = parser.parse(header, position)?.time
            ?.takeIf { position.index == header.length }
            ?: return null
        (retryAt - nowMillis).coerceAtLeast(0L)
    }
    return delayMs.coerceIn(MIN_SERVER_RETRY_DELAY_MS, MAX_SERVER_RETRY_DELAY_MS)
}

private const val HTTP_DATE_PATTERN = "EEE, dd MMM yyyy HH:mm:ss zzz"
private const val MIN_SERVER_RETRY_DELAY_MS = 1_000L
private const val MAX_SERVER_RETRY_DELAY_MS = 300_000L
private val DELTA_SECONDS_PATTERN = Regex("[0-9]+")
