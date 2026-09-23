package com.hotelalert.notificationreceiver.network

import com.hotelalert.notificationreceiver.protocol.DeviceSessionSnapshot
import com.hotelalert.notificationreceiver.protocol.DeviceSnapshotClient
import com.hotelalert.notificationreceiver.protocol.DeviceSnapshotException
import com.hotelalert.notificationreceiver.protocol.DeviceSnapshotParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class HttpDeviceSnapshotClient : DeviceSnapshotClient {
    override suspend fun fetch(serverOrigin: String, deviceId: String, token: String): DeviceSessionSnapshot = withContext(Dispatchers.IO) {
        val connection = (URL("${serverOrigin.trimEnd('/')}/api/v1/device/session").openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 10_000
            readTimeout = 10_000
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Authorization", "Bearer $token")
        }
        try {
            val responseCode = connection.responseCode
            if (responseCode !in 200..299) {
                val responseBody = connection.errorStream
                    ?.bufferedReader(Charsets.UTF_8)
                    ?.use { it.readText() }
                    .orEmpty()
                throw DeviceSnapshotException(responseCode, parseErrorCode(responseBody))
            }
            val responseBody = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            DeviceSnapshotParser.parseResponse(JSONObject(responseBody), deviceId)
        } finally {
            connection.disconnect()
        }
    }

    private fun parseErrorCode(responseBody: String): String? = runCatching {
        val error = JSONObject(responseBody).optJSONObject("error") ?: return@runCatching null
        error.optString("code")
            .takeIf { it.matches(SAFE_ERROR_CODE_PATTERN) }
    }.getOrNull()

    companion object {
        private val SAFE_ERROR_CODE_PATTERN = Regex("[A-Z][A-Z0-9_]{0,63}")
    }
}
