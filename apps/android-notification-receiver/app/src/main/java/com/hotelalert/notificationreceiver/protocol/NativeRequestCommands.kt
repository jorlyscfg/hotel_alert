package com.hotelalert.notificationreceiver.protocol

import com.hotelalert.notificationreceiver.storage.DeviceTokenStore
import com.hotelalert.notificationreceiver.receiver.NativeReceiverSnapshotStore
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

data class NativeRequestTransition(
    val requestId: String,
    val targetStatus: NativeRequestTargetStatus,
    val expectedVersion: Int,
    val idempotencyKey: String
) {
    companion object {
        private val ID_PATTERN = Regex("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")

        fun parse(rawJson: String): NativeRequestTransition {
            val json = runCatching { JSONObject(rawJson) }
                .getOrElse { throw IllegalArgumentException("The native request transition is invalid.", it) }
            val requestId = json.optString("requestId").trim()
            require(ID_PATTERN.matches(requestId)) { "The request ID is invalid." }
            val targetStatus = NativeRequestTargetStatus.parse(json.optString("targetStatus"))
            val expectedVersion = json.optInt("expectedVersion", -1)
            require(expectedVersion > 0) { "The request version is invalid." }
            val idempotencyKey = json.optString("idempotencyKey").trim()
            require(ID_PATTERN.matches(idempotencyKey)) { "The idempotency key is invalid." }
            return NativeRequestTransition(requestId, targetStatus, expectedVersion, idempotencyKey)
        }
    }
}

enum class NativeRequestTargetStatus(val endpoint: String) {
    ACCEPTED("accept"),
    IN_PROGRESS("start"),
    COMPLETED("complete");

    companion object {
        fun parse(value: String): NativeRequestTargetStatus = entries.firstOrNull { it.name == value }
            ?: throw IllegalArgumentException("The request target status is invalid.")
    }
}

class NativeRequestCommandException(
    val statusCode: Int,
    val errorCode: String?
) : IllegalStateException("The native request command failed with HTTP $statusCode.")

interface NativeRequestCommandClient {
    suspend fun transition(
        serverOrigin: String,
        deviceId: String,
        token: String,
        request: NativeRequestTransition
    ): String
}

sealed class NativeRequestCommandResult {
    data class Success(val responseJson: String) : NativeRequestCommandResult()
    data class Failure(val errorCode: String) : NativeRequestCommandResult()
}

class NativeRequestCommandCoordinator(
    private val configurationStore: ReceiverConfigurationStore,
    private val tokenStore: DeviceTokenStore,
    private val snapshotStore: NativeReceiverSnapshotStore,
    private val client: NativeRequestCommandClient
) {
    private val mutex = Mutex()

    suspend fun transition(request: NativeRequestTransition): NativeRequestCommandResult = mutex.withLock {
        val snapshot = runCatching { JSONObject(snapshotStore.read() ?: "null") }.getOrNull()
        if (snapshot?.optJSONObject("config")?.optString("mode") != "AREA") {
            return@withLock NativeRequestCommandResult.Failure("NATIVE_DEVICE_COMMANDS_UNAVAILABLE")
        }
        val configuration = configurationStore.read()
            ?: return@withLock NativeRequestCommandResult.Failure("NATIVE_DEVICE_COMMANDS_UNAVAILABLE")
        val token = runCatching { tokenStore.read() }.getOrNull()
            ?: return@withLock NativeRequestCommandResult.Failure("NATIVE_DEVICE_COMMANDS_UNAVAILABLE")
        if (token.isBlank()) return@withLock NativeRequestCommandResult.Failure("NATIVE_DEVICE_COMMANDS_UNAVAILABLE")
        runCatching {
            client.transition(configuration.serverOrigin, configuration.deviceId, token, request)
        }.fold(
            onSuccess = { NativeRequestCommandResult.Success(it) },
            onFailure = { error -> NativeRequestCommandResult.Failure(commandErrorCode(error)) }
        )
    }

    private fun commandErrorCode(error: Throwable): String = when (error) {
        is NativeRequestCommandException -> error.errorCode ?: "REQUEST_COMMAND_FAILED"
        else -> safeErrorCode(error)
    }
}
