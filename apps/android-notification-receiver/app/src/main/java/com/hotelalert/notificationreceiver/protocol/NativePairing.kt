package com.hotelalert.notificationreceiver.protocol

import com.hotelalert.notificationreceiver.web.ServerOriginStore
import com.hotelalert.notificationreceiver.web.normalizeAndValidateServerOrigin
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

data class NativePairingRequest(
    val deviceId: String,
    val deviceToken: String
) {
    init {
        require(deviceId.isNotBlank() && deviceId.length <= MAX_DEVICE_ID_LENGTH) {
            "The device ID must not be blank."
        }
        require(deviceId.none { it.isISOControl() }) {
            "The device ID is invalid."
        }
        require(deviceToken.isNotBlank() && deviceToken.length <= MAX_TOKEN_LENGTH) {
            "The device token must not be blank."
        }
        require(deviceToken.none { it.isISOControl() }) {
            "The device token is invalid."
        }
    }

    companion object {
        private const val MAX_DEVICE_ID_LENGTH = 128
        private const val MAX_TOKEN_LENGTH = 4_096

        fun parse(rawJson: String): NativePairingRequest {
            val json = runCatching { JSONObject(rawJson) }
                .getOrElse { throw IllegalArgumentException("The native pairing request is invalid.", it) }
            return NativePairingRequest(
                deviceId = json.optString("deviceId"),
                deviceToken = json.optString("deviceToken")
            )
        }
    }
}

interface PairingStateStore {
    fun readConfiguration(): ReceiverConfiguration?

    suspend fun replace(configuration: ReceiverConfiguration, token: String): PairingStateRollback
}

fun interface PairingStateRollback {
    suspend fun restore()
}

interface ReceiverServiceController {
    fun restart()
}

sealed class NativePairingResult {
    data class Success(
        val configuration: ReceiverConfiguration,
        val snapshot: DeviceSessionSnapshot
    ) : NativePairingResult()

    data class Failure(val errorCode: String) : NativePairingResult()
}

class NativePairingCoordinator(
    private val serverOriginStore: ServerOriginStore,
    private val snapshotClient: DeviceSnapshotClient,
    private val stateStore: PairingStateStore,
    private val serviceController: ReceiverServiceController,
    private val clientInstanceIdFactory: () -> String,
    private val clientVersion: String,
    private val onSnapshot: (String) -> Unit = {}
) {
    private val pairingMutex = Mutex()

    suspend fun pair(request: NativePairingRequest): NativePairingResult = pairingMutex.withLock {
        val origin = readOrigin() ?: return@withLock NativePairingResult.Failure("INVALID_SERVER_ORIGIN")
        val snapshot = try {
            snapshotClient.fetch(origin, request.deviceId, request.deviceToken)
        } catch (error: Throwable) {
            return@withLock NativePairingResult.Failure(pairingErrorCode(error))
        }
        if (snapshot.deviceId != request.deviceId) {
            return@withLock NativePairingResult.Failure("DEVICE_ID_MISMATCH")
        }

        val previousConfiguration = stateStore.readConfiguration()
        val configuration = ReceiverConfiguration(
            serverOrigin = origin,
            deviceId = request.deviceId,
            clientInstanceId = previousConfiguration?.clientInstanceId ?: clientInstanceIdFactory(),
            clientVersion = clientVersion
        )
        var rollback: PairingStateRollback? = null
        try {
            rollback = stateStore.replace(configuration, request.deviceToken)
            serviceController.restart()
            snapshot.payloadJson?.let(onSnapshot)
            return@withLock NativePairingResult.Success(configuration, snapshot)
        } catch (_: Throwable) {
            // A failed restart must not leave the next attempt using partial credentials.
            // The state store owns the token/configuration rollback details.
            runCatching { rollback?.restore() }
            return@withLock NativePairingResult.Failure("PAIRING_START_FAILED")
        }
    }

    private fun readOrigin(): String? = runCatching {
        val storedOrigin = serverOriginStore.read() ?: return@runCatching null
        normalizeAndValidateServerOrigin(storedOrigin)
    }.getOrNull()

    private fun pairingErrorCode(error: Throwable): String = when {
        authenticationFailureCode(error) != null -> authenticationFailureCode(error)!!
        error is DeviceSnapshotException -> error.errorCode ?: "SNAPSHOT_UNAVAILABLE"
        error is IllegalArgumentException -> "INVALID_ASSIGNMENT"
        else -> "PAIRING_FAILED"
    }
}
