package com.hotelalert.notificationreceiver.receiver

import com.hotelalert.notificationreceiver.protocol.ConnectionReady
import com.hotelalert.notificationreceiver.protocol.DeviceSnapshotClient
import com.hotelalert.notificationreceiver.protocol.DeviceSessionSnapshot
import com.hotelalert.notificationreceiver.protocol.DurableCursorStore
import com.hotelalert.notificationreceiver.protocol.NotificationReceiverCore
import com.hotelalert.notificationreceiver.protocol.NotificationSink
import com.hotelalert.notificationreceiver.protocol.ReceiverConfiguration
import com.hotelalert.notificationreceiver.protocol.ReceiverConfigurationStore
import com.hotelalert.notificationreceiver.protocol.ReceiverState
import com.hotelalert.notificationreceiver.protocol.RealtimeSocket
import com.hotelalert.notificationreceiver.protocol.RealtimeSocketFactory
import com.hotelalert.notificationreceiver.protocol.SyncMode
import com.hotelalert.notificationreceiver.protocol.authenticationFailureCode
import com.hotelalert.notificationreceiver.protocol.buildRealtimeAuth
import com.hotelalert.notificationreceiver.protocol.parseConnectionReady
import com.hotelalert.notificationreceiver.protocol.parseSyncRequired
import com.hotelalert.notificationreceiver.protocol.parseTransportAck
import com.hotelalert.notificationreceiver.protocol.safeErrorCode
import com.hotelalert.notificationreceiver.protocol.NotificationReceiverCore.HandleResult
import com.hotelalert.notificationreceiver.storage.DeviceTokenStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class AndroidLanReceiver(
    private val configurationStore: ReceiverConfigurationStore,
    private val tokenStore: DeviceTokenStore,
    private val cursorStore: DurableCursorStore,
    private val snapshotClient: DeviceSnapshotClient,
    private val socketFactory: RealtimeSocketFactory,
    private val sink: NotificationSink,
    private val scope: CoroutineScope,
    private val onStateChanged: (ReceiverState) -> Unit = {},
    private val onAuthFailure: (String) -> Unit = {},
    private val onDeviceInvalidated: suspend (String) -> Unit = {},
    private val onError: (String) -> Unit = {},
    private val onSnapshotChanged: (String?) -> Unit = {}
) {
    private data class BufferedEvent(val eventName: String, val payload: Any?)

    private var configuration: ReceiverConfiguration? = null
    private var snapshot: DeviceSessionSnapshot? = null
    private var socket: RealtimeSocket? = null
    private var core: NotificationReceiverCore? = null
    private var streamSynchronized = false
    private var lastSeenEventSequence = cursorStore.lastSeenEventSequence
    private var synchronizedInFlight = false
    private var resyncRequested = false
    private var startRequested = false
    private var stopped = false
    private var authFailed = false
    private var heartbeatInFlight = false
    private var heartbeatJob: Job? = null
    private val bufferedEvents = mutableListOf<BufferedEvent>()
    private val eventMutex = Mutex()
    private val handlers = mutableMapOf<String, (Any?) -> Unit>()

    suspend fun start() {
        if (startRequested) return
        if (stopped) throw IllegalStateException("The Android LAN receiver has been stopped.")
        startRequested = true
        setState(ReceiverState.FETCHING_SNAPSHOT)
        try {
            val nextConfiguration = configurationStore.read()
                ?: throw IllegalStateException("The Android receiver is not configured.")
            val token = tokenStore.read()
                ?: throw IllegalStateException("The Android receiver has no device token.")
            configuration = nextConfiguration
            val nextSnapshot = snapshotClient.fetch(nextConfiguration.serverOrigin, nextConfiguration.deviceId, token)
            replaceSnapshot(nextSnapshot, advanceCursor = false)
            val auth = buildAuth(token)
            val nextSocket = socketFactory.create(nextConfiguration.serverOrigin, auth)
            socket = nextSocket
            attachSocketHandlers(nextSocket)
            setState(ReceiverState.CONNECTING)
            nextSocket.connect()
        } catch (error: Throwable) {
            heartbeatJob?.cancel()
            heartbeatJob = null
            streamSynchronized = false
            detachSocketHandlers()
            socket?.disconnect()
            socket = null
            startRequested = false
            val authenticationCode = authenticationFailureCode(error)
            if (authenticationCode != null) {
                handleAuthenticationFailure(authenticationCode)
            } else {
                setState(ReceiverState.ERROR)
                onError(safeErrorCode(error))
            }
        }
    }

    fun stop() {
        if (stopped) return
        stopped = true
        streamSynchronized = false
        heartbeatJob?.cancel()
        heartbeatJob = null
        detachSocketHandlers()
        socket?.disconnect()
        setState(ReceiverState.STOPPED)
    }

    private fun attachSocketHandlers(nextSocket: RealtimeSocket) {
        register(nextSocket, "connection.ready") { payload ->
            scope.launch { handleConnectionReady(payload) }
        }
        register(nextSocket, "sync.required") { payload ->
            scope.launch { handleSyncRequired(payload) }
        }
        register(nextSocket, "connect") {
            if (!stopped && !authFailed) setState(ReceiverState.CONNECTED)
        }
        register(nextSocket, "disconnect") {
            if (stopped || authFailed) return@register
            streamSynchronized = false
            heartbeatJob?.cancel()
            heartbeatJob = null
            setState(ReceiverState.CONNECTING)
        }
        register(nextSocket, "connect_error") { error ->
            scope.launch { handleConnectError(error) }
        }
        for (eventName in DURABLE_EVENT_NAMES) {
            register(nextSocket, eventName) { payload ->
                scope.launch { handleInboundEvent(eventName, payload) }
            }
        }
    }

    private fun register(socket: RealtimeSocket, eventName: String, listener: (Any?) -> Unit) {
        handlers[eventName] = listener
        socket.on(eventName, listener)
    }

    private fun detachSocketHandlers() {
        val activeSocket = socket ?: return
        handlers.forEach { (eventName, listener) -> activeSocket.off(eventName, listener) }
        handlers.clear()
    }

    private suspend fun handleConnectionReady(payload: Any?) {
        if (stopped || authFailed) return
        val ready = parseConnectionReady(payload)
        if (ready == null) {
            handleRuntimeError("INVALID_CONNECTION_READY")
            return
        }
        synchronize(ready.sync == SyncMode.FULL_SNAPSHOT_REQUIRED)
    }

    private suspend fun handleSyncRequired(payload: Any?) {
        if (stopped || authFailed) return
        if (parseSyncRequired(payload) == null) {
            handleRuntimeError("INVALID_SYNC_REQUIRED")
            return
        }
        resyncRequested = true
        synchronize(refreshSnapshot = true)
    }

    private suspend fun synchronize(refreshSnapshot: Boolean) {
        if (synchronizedInFlight) {
            if (refreshSnapshot) resyncRequested = true
            return
        }
        synchronizedInFlight = true
        var shouldRefresh = refreshSnapshot || resyncRequested
        resyncRequested = false
        streamSynchronized = false
        heartbeatJob?.cancel()
        heartbeatJob = null
        setState(ReceiverState.SYNCHRONIZING)
        try {
            while (true) {
                if (shouldRefresh) {
                    val config = configuration ?: throw IllegalStateException("The receiver configuration is unavailable.")
                    val token = tokenStore.read()
                        ?: throw IllegalStateException("The Android receiver has no device token.")
                    replaceSnapshot(
                        snapshotClient.fetch(config.serverOrigin, config.deviceId, token),
                        advanceCursor = true
                    )
                    shouldRefresh = false
                }
                val activeSocket = socket ?: throw IllegalStateException("The realtime socket is unavailable.")
                val payload = JSONObject()
                    .put("lastSeenEventSequence", lastSeenEventSequence)
                snapshot?.deviceConfigVersion?.let { payload.put("deviceConfigVersion", it) }
                val response = emitAcknowledged(activeSocket, "connection.sync", payload)
                if (!response.ok) {
                    val code = response.errorCode
                    if (code != null && authenticationFailureCode(JSONObject().put("errorCode", code)) != null) {
                        throw AuthenticationFailureException(code)
                    }
                    throw IllegalStateException("Realtime synchronization failed: ${code ?: "UNKNOWN_ERROR"}.")
                }
                if (response.sync == SyncMode.FULL_SNAPSHOT_REQUIRED) {
                    shouldRefresh = true
                    continue
                }
                streamSynchronized = true
                setState(ReceiverState.SYNCHRONIZED)
                drainBufferedEvents()
                scheduleHeartbeat()
                if (resyncRequested) {
                    resyncRequested = false
                    shouldRefresh = true
                    continue
                }
                return
            }
        } catch (error: Throwable) {
            if (error is AuthenticationFailureException) {
                handleAuthenticationFailure(error.errorCode)
            } else {
                handleRuntimeError(safeErrorCode(error))
            }
        } finally {
            synchronizedInFlight = false
        }
    }

    private suspend fun handleInboundEvent(eventName: String, payload: Any?) {
        if (stopped || authFailed) return
        val requiresResync = try {
            eventMutex.withLock {
                processEvent(eventName, payload)
            }
        } catch (error: Throwable) {
            requeueFailedEvent(BufferedEvent(eventName, payload))
            handleRuntimeError(safeErrorCode(error))
            return
        }
        if (requiresResync) synchronize(refreshSnapshot = true)
    }

    private suspend fun processEvent(eventName: String, payload: Any?): Boolean {
        if (!streamSynchronized) {
            bufferedEvents += BufferedEvent(eventName, payload)
            return false
        }
        if (eventName == "device.token.rotation.required") {
            handleAuthenticationFailure("TOKEN_ROTATION_REQUIRED")
            return false
        }
        val event = payload as? JSONObject
        if (event == null) {
            handleRuntimeError("INVALID_DURABLE_EVENT")
            return false
        }
        val activeCore = core ?: return false
        val result = activeCore.handle(event, synchronized = true)
        if (result.outcome == NotificationReceiverCore.HandleOutcome.DEFERRED) {
            bufferedEvents += BufferedEvent(eventName, payload)
            return false
        }
        lastSeenEventSequence = maxOf(lastSeenEventSequence, result.cursorSequence)
        if (result.cursorAdvanced) {
            acknowledgeEvent(result, event)
        }
        if (eventName == "device.config.changed" || eventName == "request.created" || eventName == "request.updated") {
            resyncRequested = true
            return true
        }
        return false
    }

    private suspend fun drainBufferedEvents() {
        val pending = eventMutex.withLock {
            val copy = bufferedEvents.toList()
            bufferedEvents.clear()
            copy
        }
        for (index in pending.indices) {
            val item = pending[index]
            val requiresResync = try {
                eventMutex.withLock {
                    processEvent(item.eventName, item.payload)
                }
            } catch (error: Throwable) {
                eventMutex.withLock {
                    bufferedEvents.addAll(0, pending.subList(index, pending.size))
                }
                handleRuntimeError(safeErrorCode(error))
                return
            }
            if (requiresResync) resyncRequested = true
        }
    }

    private suspend fun requeueFailedEvent(event: BufferedEvent) {
        eventMutex.withLock {
            if (bufferedEvents.none { it.isSameEvent(event) }) bufferedEvents += event
        }
    }

    private fun BufferedEvent.isSameEvent(other: BufferedEvent): Boolean {
        if (eventName != other.eventName) return false
        if (payload === other.payload) return true
        val eventId = (payload as? JSONObject)?.optString("eventId")?.takeIf { it.isNotEmpty() }
        val otherEventId = (other.payload as? JSONObject)?.optString("eventId")?.takeIf { it.isNotEmpty() }
        return eventId != null && eventId == otherEventId
    }

    private suspend fun acknowledgeEvent(result: HandleResult, event: JSONObject) {
        val activeSocket = socket ?: return
        if (!activeSocket.connected) return
        val eventId = when (result) {
            is NotificationReceiverCore.DeliveredResult -> result.notification.eventId
            else -> event.optString("eventId").takeIf { it.isNotEmpty() }
        } ?: return
        val response = emitAcknowledged(activeSocket, "client.event.received", JSONObject().put("eventId", eventId))
        if (!response.ok) {
            val code = response.errorCode ?: "EVENT_RECEIPT_FAILED"
            if (authenticationFailureCode(JSONObject().put("errorCode", code)) != null) {
                handleAuthenticationFailure(code)
            } else {
                handleRuntimeError(code)
            }
        }
    }

    private fun scheduleHeartbeat() {
        heartbeatJob?.cancel()
        val interval = snapshot?.heartbeatIntervalMs ?: return
        if (!streamSynchronized || interval <= 0) return
        heartbeatJob = scope.launch {
            while (isActive) {
                delay(interval)
                sendHeartbeat()
            }
        }
    }

    private suspend fun sendHeartbeat() {
        val activeSocket = socket ?: return
        val config = configuration ?: return
        if (heartbeatInFlight || stopped || authFailed || !streamSynchronized || !activeSocket.connected) return
        heartbeatInFlight = true
        try {
            val response = emitAcknowledged(
                activeSocket,
                "device.heartbeat",
                JSONObject().put("clientVersion", config.clientVersion).put("socketConnected", true)
            )
            if (!response.ok) {
                val code = response.errorCode ?: "HEARTBEAT_FAILED"
                if (authenticationFailureCode(JSONObject().put("errorCode", code)) != null) {
                    handleAuthenticationFailure(code)
                } else {
                    handleRuntimeError(code)
                }
            }
        } finally {
            heartbeatInFlight = false
        }
    }

    private suspend fun emitAcknowledged(socket: RealtimeSocket, eventName: String, payload: JSONObject) = withTimeout(10_000) {
        suspendCancellableCoroutine { continuation ->
            try {
                socket.emit(eventName, payload) { response ->
                    if (continuation.isActive) continuation.resume(parseTransportAck(response))
                }
            } catch (error: Throwable) {
                if (continuation.isActive) continuation.resumeWithException(error)
            }
        }
    }

    private suspend fun replaceSnapshot(nextSnapshot: DeviceSessionSnapshot, advanceCursor: Boolean) {
        val config = configuration
        if (config != null && nextSnapshot.deviceId != config.deviceId) {
            throw IllegalStateException("The device session snapshot does not match the configured device.")
        }
        if (advanceCursor && nextSnapshot.currentEventSequence > lastSeenEventSequence) {
            cursorStore.advanceTo(nextSnapshot.currentEventSequence)
            lastSeenEventSequence = nextSnapshot.currentEventSequence
        }
        val previousAreaId = snapshot?.areaId
        snapshot = nextSnapshot
        onSnapshotChanged(nextSnapshot.payloadJson)
        core = NotificationReceiverCore(nextSnapshot.areaId, cursorStore, sink)
        val token = tokenStore.read()
        if (token != null && config != null) {
            socket?.updateAuth(buildAuth(token))
        }
        if (previousAreaId != null && previousAreaId != nextSnapshot.areaId) bufferedEvents.clear()
    }

    private suspend fun handleConnectError(error: Any?) {
        if (stopped || authFailed) return
        val code = authenticationFailureCode(error)
        if (code != null) {
            handleAuthenticationFailure(code)
            return
        }
        setState(ReceiverState.ERROR)
        onError(safeErrorCode(error))
    }

    private suspend fun handleAuthenticationFailure(errorCode: String) {
        if (stopped || authFailed) return
        authFailed = true
        streamSynchronized = false
        heartbeatJob?.cancel()
        heartbeatJob = null
        socket?.disableReconnection()
        detachSocketHandlers()
        socket?.disconnect()
        setState(ReceiverState.AUTH_FAILED)
        if (errorCode == "DEVICE_INACTIVE" || errorCode == "DEVICE_TOKEN_REVOKED") {
            onDeviceInvalidated(errorCode)
        }
        onAuthFailure(errorCode)
    }

    private fun handleRuntimeError(errorCode: String) {
        if (stopped || authFailed) return
        setState(ReceiverState.ERROR)
        onError(errorCode)
    }

    private fun buildAuth(token: String): JSONObject {
        val config = configuration ?: throw IllegalStateException("The receiver configuration is unavailable.")
        return buildRealtimeAuth(config, token, lastSeenEventSequence, snapshot?.deviceConfigVersion)
    }

    private fun setState(next: ReceiverState) {
        onStateChanged(next)
    }

    private class AuthenticationFailureException(val errorCode: String) : Exception(errorCode)

    companion object {
        private val DURABLE_EVENT_NAMES = listOf(
            "request.created",
            "request.updated",
            "device.config.changed",
            "device.token.rotation.required",
            "service.catalog.changed",
            "room.updated",
            "device.presence.changed",
            "system.maintenance"
        )
    }
}
