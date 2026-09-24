package com.hotelalert.notificationreceiver.protocol

import com.hotelalert.notificationreceiver.web.ServerOriginStore
import com.hotelalert.notificationreceiver.web.normalizeAndValidateServerOrigin
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class RoomPresenceConfiguration(
    val serverOrigin: String,
    val deviceId: String,
    val clientVersion: String
)

data class RoomPresenceSession(val configuration: RoomPresenceConfiguration, val token: String) {
    override fun toString(): String = "RoomPresenceSession(deviceId=${configuration.deviceId}, token=[REDACTED])"
}

interface RoomPresenceSessionStore {
    suspend fun read(): RoomPresenceSession?

    suspend fun replace(configuration: RoomPresenceConfiguration, token: String)

    suspend fun stageToken(token: String)

    suspend fun readStagedToken(): String?

    suspend fun activateStagedToken(configuration: RoomPresenceConfiguration, expectedToken: String): Boolean

    suspend fun clear(invalidated: Boolean)

    fun wasInvalidated(): Boolean
}

data class RoomPresenceSnapshot(
    val deviceId: String,
    val assignmentMode: String,
    val active: Boolean,
    val roomId: String?,
    val heartbeatIntervalMs: Long
)

class RoomPresenceException(val statusCode: Int, val errorCode: String?) :
    IllegalStateException("The ROOM presence request failed with HTTP $statusCode.")

interface RoomPresenceClient {
    suspend fun fetchSession(serverOrigin: String, deviceId: String, token: String): RoomPresenceSnapshot

    suspend fun sendHeartbeat(serverOrigin: String, deviceId: String, token: String, clientVersion: String)
}

interface RoomPresenceServiceController {
    fun start()

    fun stop()
}

enum class RoomPresenceState {
    IDLE,
    STARTING,
    CONNECTING,
    ONLINE,
    RETRYING,
    INVALIDATED,
    STOPPED
}

class RoomPresenceStatusStore(initial: RoomPresenceState = RoomPresenceState.IDLE) {
    @Volatile
    var state: RoomPresenceState = initial
        private set

    fun update(next: RoomPresenceState) {
        state = next
    }
}

sealed class RoomPresenceCycle {
    data class Online(val heartbeatIntervalMs: Long) : RoomPresenceCycle()
    data class Retry(val errorCode: String) : RoomPresenceCycle()
    data object Invalidated : RoomPresenceCycle()
    data object Unconfigured : RoomPresenceCycle()
}

class NativeRoomSessionCoordinator(
    private val serverOriginStore: ServerOriginStore,
    private val sessionStore: RoomPresenceSessionStore,
    private val serviceController: RoomPresenceServiceController,
    private val statusStore: RoomPresenceStatusStore,
    private val clientVersion: String
) {
    private val mutex = Mutex()

    suspend fun configure(deviceId: String, token: String) = mutex.withLock {
        require(deviceId.isNotBlank() && deviceId.length <= 128 && deviceId.none(Char::isISOControl)) {
            "The ROOM device ID is invalid."
        }
        require(token.isNotBlank() && token.length <= 4_096 && token.none(Char::isISOControl)) {
            "The ROOM device token is invalid."
        }
        val origin = runCatching {
            normalizeAndValidateServerOrigin(serverOriginStore.read() ?: error("The server address is missing."))
        }.getOrElse { throw IllegalStateException("The configured server address is invalid.", it) }
        val configuration = RoomPresenceConfiguration(origin, deviceId, clientVersion)
        val current = sessionStore.read()
        if (current?.configuration == configuration) {
            // A reloaded WebView can still hold the revoked token while the native
            // store already has its replacement staged. Preserve that recovery state.
            if (sessionStore.readStagedToken() == null && current.token != token) {
                sessionStore.stageToken(token)
            }
        } else {
            sessionStore.replace(configuration, token)
        }
        try {
            statusStore.update(RoomPresenceState.STARTING)
            serviceController.start()
        } catch (error: Throwable) {
            statusStore.update(RoomPresenceState.STOPPED)
            throw IllegalStateException("The ROOM presence service could not start.", error)
        }
    }

    suspend fun stageToken(token: String) {
        require(token.isNotBlank() && token.length <= 4_096 && token.none(Char::isISOControl)) {
            "The ROOM device token is invalid."
        }
        sessionStore.stageToken(token)
    }

    suspend fun clear() = mutex.withLock {
        sessionStore.clear(invalidated = false)
        serviceController.stop()
        statusStore.update(RoomPresenceState.STOPPED)
    }
}

class RoomPresenceCoordinator(
    private val sessionStore: RoomPresenceSessionStore,
    private val client: RoomPresenceClient,
    private val statusStore: RoomPresenceStatusStore
) {
    private val mutex = Mutex()

    suspend fun runOnce(): RoomPresenceCycle = mutex.withLock {
        val session = sessionStore.read()
            ?: return@withLock RoomPresenceCycle.Unconfigured
        statusStore.update(RoomPresenceState.CONNECTING)
        try {
            RoomPresenceCycle.Online(heartbeat(session))
        } catch (error: Throwable) {
            if (error is CancellationException) throw error
            if (error.isTokenRevoked()) {
                val replacement = sessionStore.readStagedToken()
                if (replacement != null) {
                    try {
                        val interval = heartbeat(session.copy(token = replacement))
                        if (!sessionStore.activateStagedToken(session.configuration, replacement)) {
                            statusStore.update(RoomPresenceState.RETRYING)
                            return@withLock RoomPresenceCycle.Retry(ROOM_TOKEN_CHANGED_DURING_VALIDATION)
                        }
                        return@withLock RoomPresenceCycle.Online(interval)
                    } catch (replacementError: Throwable) {
                        if (replacementError is CancellationException) throw replacementError
                        if (replacementError.isConfirmedInvalidation()) return@withLock invalidate()
                        statusStore.update(RoomPresenceState.RETRYING)
                        return@withLock RoomPresenceCycle.Retry(safeRoomErrorCode(replacementError))
                    }
                }
            }
            if (error.isConfirmedInvalidation()) return@withLock invalidate()
            statusStore.update(RoomPresenceState.RETRYING)
            RoomPresenceCycle.Retry(safeRoomErrorCode(error))
        }
    }

    private suspend fun heartbeat(session: RoomPresenceSession): Long {
        val snapshot = client.fetchSession(
            session.configuration.serverOrigin,
            session.configuration.deviceId,
            session.token
        )
        if (snapshot.deviceId != session.configuration.deviceId || snapshot.assignmentMode != "ROOM" ||
            !snapshot.active || snapshot.roomId.isNullOrBlank()
        ) {
            throw RoomPresenceException(403, "FORBIDDEN_ASSIGNMENT")
        }
        client.sendHeartbeat(
            session.configuration.serverOrigin,
            session.configuration.deviceId,
            session.token,
            session.configuration.clientVersion
        )
        statusStore.update(RoomPresenceState.ONLINE)
        return snapshot.heartbeatIntervalMs.coerceAtLeast(MIN_HEARTBEAT_INTERVAL_MS)
    }

    private suspend fun invalidate(): RoomPresenceCycle.Invalidated {
        sessionStore.clear(invalidated = true)
        statusStore.update(RoomPresenceState.INVALIDATED)
        return RoomPresenceCycle.Invalidated
    }

    private fun Throwable.isTokenRevoked(): Boolean =
        (this as? RoomPresenceException)?.errorCode == "DEVICE_TOKEN_REVOKED"

    private fun Throwable.isConfirmedInvalidation(): Boolean = when ((this as? RoomPresenceException)?.errorCode) {
        "DEVICE_INACTIVE", "DEVICE_TOKEN_REVOKED", "FORBIDDEN_ASSIGNMENT", "INACTIVE_DEPENDENCY" -> true
        else -> false
    }

    private fun safeRoomErrorCode(error: Throwable): String =
        (error as? RoomPresenceException)?.errorCode?.takeIf { it.matches(SAFE_ERROR_CODE_PATTERN) }
            ?: if (error is RoomPresenceException) "HTTP_${error.statusCode}" else error::class.java.simpleName

    companion object {
        private const val MIN_HEARTBEAT_INTERVAL_MS = 10_500L
        private const val ROOM_TOKEN_CHANGED_DURING_VALIDATION = "ROOM_TOKEN_CHANGED_DURING_VALIDATION"
        private val SAFE_ERROR_CODE_PATTERN = Regex("[A-Z][A-Z0-9_]{0,63}")
    }
}

fun roomPresenceRetryDelayMs(attempt: Int): Long {
    val normalizedAttempt = attempt.coerceAtLeast(1)
    return (1_000L * (1L shl (normalizedAttempt - 1).coerceAtMost(6))).coerceAtMost(60_000L)
}
