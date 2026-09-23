package com.hotelalert.notificationreceiver.network

import com.hotelalert.notificationreceiver.protocol.NativeRequestCommandClient
import com.hotelalert.notificationreceiver.protocol.NativeRequestCommandException
import com.hotelalert.notificationreceiver.protocol.NativeRequestTransition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class HttpDeviceRequestCommandClient : NativeRequestCommandClient {
    override suspend fun transition(
        serverOrigin: String,
        deviceId: String,
        token: String,
        request: NativeRequestTransition
    ): String = withContext(Dispatchers.IO) {
        val url = "${serverOrigin.trimEnd('/')}/api/v1/requests/${encode(request.requestId)}/${request.targetStatus.endpoint}"
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 10_000
            readTimeout = 10_000
            doOutput = true
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Idempotency-Key", request.idempotencyKey)
            setRequestProperty("X-Device-Id", deviceId)
        }
        try {
            connection.outputStream.bufferedWriter(Charsets.UTF_8).use { writer ->
                writer.write(JSONObject().put("expectedVersion", request.expectedVersion).toString())
            }
            val responseCode = connection.responseCode
            val stream = if (responseCode in 200..299) connection.inputStream else connection.errorStream
            val responseBody = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (responseCode !in 200..299) throw NativeRequestCommandException(responseCode, parseErrorCode(responseBody))
            responseBody
        } finally {
            connection.disconnect()
        }
    }

    private fun parseErrorCode(responseBody: String): String? = runCatching {
        JSONObject(responseBody).optJSONObject("error")?.optString("code")
            ?.takeIf { it.matches(SAFE_ERROR_CODE_PATTERN) }
    }.getOrNull()

    private fun encode(value: String): String = java.net.URLEncoder.encode(value, Charsets.UTF_8.name())

    companion object {
        private val SAFE_ERROR_CODE_PATTERN = Regex("[A-Z][A-Z0-9_]{0,63}")
    }
}
