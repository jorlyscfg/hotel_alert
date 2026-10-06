package com.hotelalert.notificationreceiver.web

import android.webkit.JavascriptInterface
import com.hotelalert.notificationreceiver.RoomScreensaverButtonAction
import com.hotelalert.notificationreceiver.protocol.NativePairingCoordinator
import com.hotelalert.notificationreceiver.protocol.NativePairingRequest
import com.hotelalert.notificationreceiver.protocol.NativePairingResult
import com.hotelalert.notificationreceiver.protocol.NativeRoomSessionCoordinator
import com.hotelalert.notificationreceiver.protocol.NativeRequestCommandCoordinator
import com.hotelalert.notificationreceiver.protocol.NativeRequestCommandResult
import com.hotelalert.notificationreceiver.protocol.NativeRequestTransition
import com.hotelalert.notificationreceiver.protocol.RoomPresenceState
import com.hotelalert.notificationreceiver.protocol.RoomPresenceStatusStore
import com.hotelalert.notificationreceiver.receiver.NativeReceiverSnapshotStore
import com.hotelalert.notificationreceiver.receiver.ReceiverStatusStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import java.util.UUID

class HotelAlertWebBridge(
    private val scope: CoroutineScope? = null,
    private val pairingCoordinator: NativePairingCoordinator? = null,
    private val snapshotStore: NativeReceiverSnapshotStore? = null,
    private val statusStore: ReceiverStatusStore? = null,
    private val commandCoordinator: NativeRequestCommandCoordinator? = null,
    private val roomSessionCoordinator: NativeRoomSessionCoordinator? = null,
    private val roomPresenceStatusStore: RoomPresenceStatusStore? = null
) {
    private sealed class PairingState {
        data object Pending : PairingState()
        data class Succeeded(val deviceId: String) : PairingState()
        data class Failed(val errorCode: String) : PairingState()
    }

    private val pairingStates = linkedMapOf<String, PairingState>()
    private val roomScreensaverListenerLock = Any()
    private var roomScreensaverListenerOwner: Any? = null
    private var roomScreensaverStateListener: ((Boolean) -> Unit)? = null
    private val roomScreensaverButtonListenerLock = Any()
    private var roomScreensaverButtonListenerOwner: Any? = null
    private var roomScreensaverButtonListener: ((RoomScreensaverButtonAction) -> Unit)? = null

    private sealed class CommandState {
        data object Pending : CommandState()
        data class Succeeded(val responseJson: String) : CommandState()
        data class Failed(val errorCode: String, val serverRequestId: String? = null) : CommandState()
    }

    private val commandStates = linkedMapOf<String, CommandState>()

    @JavascriptInterface
    fun getCapabilities(): String = if (isEnabled) {
        if (commandCoordinator === null) NativeWebViewBridgeContract.readOnlyCapabilitiesJson else NativeWebViewBridgeContract.capabilitiesJson
    } else {
        NativeWebViewBridgeContract.unavailableCapabilitiesJson
    }

    @JavascriptInterface
    fun pairDevice(rawJson: String): String {
        val requestId = UUID.randomUUID().toString()
        val coordinator = pairingCoordinator
        val pairingScope = scope
        if (!isEnabled || coordinator == null || pairingScope == null) {
            setPairingState(requestId, PairingState.Failed("NATIVE_PAIRING_UNAVAILABLE"))
            return pairingAcceptedJson(requestId)
        }

        val request = runCatching { NativePairingRequest.parse(rawJson) }.getOrElse {
            setPairingState(requestId, PairingState.Failed("INVALID_PAIRING_REQUEST"))
            return pairingAcceptedJson(requestId)
        }
        setPairingState(requestId, PairingState.Pending)
        pairingScope.launch {
            val result = coordinator.pair(request)
            setPairingState(
                requestId,
                when (result) {
                    is NativePairingResult.Success -> PairingState.Succeeded(result.configuration.deviceId)
                    is NativePairingResult.Failure -> PairingState.Failed(result.errorCode)
                }
            )
        }
        return pairingAcceptedJson(requestId)
    }

    @JavascriptInterface
    fun getPairingStatus(requestId: String): String {
        val state = synchronized(pairingStates) { pairingStates[requestId] }
            ?: return pairingStatusJson(requestId, PairingState.Failed("UNKNOWN_PAIRING_REQUEST"))
        return pairingStatusJson(requestId, state)
    }

    @JavascriptInterface
    fun transitionRequest(rawJson: String): String {
        val requestId = UUID.randomUUID().toString()
        val coordinator = commandCoordinator
        val commandScope = scope
        if (!isEnabled || coordinator == null || commandScope == null) {
            setCommandState(requestId, CommandState.Failed("NATIVE_DEVICE_COMMANDS_UNAVAILABLE"))
            return commandAcceptedJson(requestId)
        }
        val request = runCatching { NativeRequestTransition.parse(rawJson) }.getOrElse {
            setCommandState(requestId, CommandState.Failed("INVALID_REQUEST_COMMAND"))
            return commandAcceptedJson(requestId)
        }
        setCommandState(requestId, CommandState.Pending)
        commandScope.launch {
            val result = coordinator.transition(request)
            setCommandState(
                requestId,
                when (result) {
                    is NativeRequestCommandResult.Success -> CommandState.Succeeded(result.responseJson)
                    is NativeRequestCommandResult.Failure -> CommandState.Failed(result.errorCode, result.serverRequestId)
                }
            )
        }
        return commandAcceptedJson(requestId)
    }

    @JavascriptInterface
    fun getCommandStatus(requestId: String): String {
        val state = synchronized(commandStates) { commandStates[requestId] }
            ?: return commandStatusJson(requestId, CommandState.Failed("UNKNOWN_REQUEST_COMMAND"))
        return commandStatusJson(requestId, state)
    }

    @JavascriptInterface
    fun getSnapshot(): String = snapshotStore?.read() ?: "null"

    @JavascriptInterface
    fun getReceiverState(): String = statusStore?.state?.value?.name ?: "UNAVAILABLE"

    @JavascriptInterface
    fun setRoomSession(rawJson: String): String {
        val coordinator = roomSessionCoordinator ?: return roomOperationRejected("NATIVE_ROOM_PRESENCE_UNAVAILABLE")
        val request = runCatching { NativePairingRequest.parse(rawJson) }
            .getOrElse { return roomOperationRejected("INVALID_ROOM_SESSION") }
        return runRoomOperation {
            coordinator.configure(request.deviceId, request.deviceToken)
            Unit
        }
    }

    @JavascriptInterface
    fun stageRoomSessionToken(token: String): String = runRoomOperation("NATIVE_ROOM_PRESENCE_UNAVAILABLE") {
        roomSessionCoordinator?.stageToken(token) ?: throw IllegalStateException("ROOM presence is unavailable.")
    }

    @JavascriptInterface
    fun clearRoomSession(): String = runRoomOperation("NATIVE_ROOM_PRESENCE_UNAVAILABLE") {
        roomSessionCoordinator?.clear() ?: throw IllegalStateException("ROOM presence is unavailable.")
    }

    @JavascriptInterface
    fun getRoomPresenceState(): String = roomPresenceStatusStore?.state?.name ?: RoomPresenceState.IDLE.name

    @JavascriptInterface
    fun setRoomScreensaverActive(active: Boolean): Boolean {
        val listener = synchronized(roomScreensaverListenerLock) { roomScreensaverStateListener }
            ?: return false
        listener(active)
        return true
    }

    fun bindRoomScreensaverStateListener(owner: Any, listener: (Boolean) -> Unit) {
        synchronized(roomScreensaverListenerLock) {
            roomScreensaverListenerOwner = owner
            roomScreensaverStateListener = listener
        }
    }

    fun unbindRoomScreensaverStateListener(owner: Any) {
        val listener = synchronized(roomScreensaverListenerLock) {
            if (roomScreensaverListenerOwner !== owner) return
            roomScreensaverListenerOwner = null
            roomScreensaverStateListener.also { roomScreensaverStateListener = null }
        }
        listener?.invoke(false)
    }

    fun clearRoomScreensaverState() {
        val listener = synchronized(roomScreensaverListenerLock) { roomScreensaverStateListener }
        listener?.invoke(false)
    }

    internal fun dispatchRoomScreensaverButton(action: RoomScreensaverButtonAction): Boolean {
        if (action != RoomScreensaverButtonAction.TOGGLE_DO_NOT_DISTURB) return false
        val listener = synchronized(roomScreensaverButtonListenerLock) { roomScreensaverButtonListener }
            ?: return false
        listener(action)
        return true
    }

    internal fun bindRoomScreensaverButtonListener(owner: Any, listener: (RoomScreensaverButtonAction) -> Unit) {
        synchronized(roomScreensaverButtonListenerLock) {
            roomScreensaverButtonListenerOwner = owner
            roomScreensaverButtonListener = listener
        }
    }

    internal fun unbindRoomScreensaverButtonListener(owner: Any) {
        synchronized(roomScreensaverButtonListenerLock) {
            if (roomScreensaverButtonListenerOwner !== owner) return
            roomScreensaverButtonListenerOwner = null
            roomScreensaverButtonListener = null
        }
    }

    private val isEnabled: Boolean
        get() = scope != null && pairingCoordinator != null && snapshotStore != null && statusStore != null

    private fun runRoomOperation(
        unavailableCode: String = "ROOM_PRESENCE_FAILED",
        operation: suspend () -> Unit
    ): String {
        if (roomSessionCoordinator == null) return roomOperationRejected(unavailableCode)
        return try {
            runBlocking(Dispatchers.IO) { operation() }
            JSONObject().put("accepted", true).toString()
        } catch (error: Throwable) {
            val code = if (error is IllegalArgumentException) "INVALID_ROOM_SESSION" else "ROOM_PRESENCE_FAILED"
            roomOperationRejected(code)
        }
    }

    private fun roomOperationRejected(errorCode: String): String = JSONObject()
        .put("accepted", false)
        .put("errorCode", errorCode)
        .toString()

    private fun setPairingState(requestId: String, state: PairingState) {
        synchronized(pairingStates) {
            pairingStates[requestId] = state
            while (pairingStates.size > MAX_PAIRING_REQUESTS) pairingStates.remove(pairingStates.keys.first())
        }
    }

    private fun pairingAcceptedJson(requestId: String): String = JSONObject()
        .put("requestId", requestId)
        .put("accepted", true)
        .toString()

    private fun pairingStatusJson(requestId: String, state: PairingState): String = JSONObject()
        .put("requestId", requestId)
        .apply {
            when (state) {
                PairingState.Pending -> put("state", "PENDING")
                is PairingState.Succeeded -> put("state", "SUCCEEDED").put("deviceId", state.deviceId)
                is PairingState.Failed -> put("state", "FAILED").put("errorCode", state.errorCode)
            }
        }
        .toString()

    private fun setCommandState(requestId: String, state: CommandState) {
        synchronized(commandStates) {
            commandStates[requestId] = state
            while (commandStates.size > MAX_COMMAND_REQUESTS) commandStates.remove(commandStates.keys.first())
        }
    }

    private fun commandAcceptedJson(requestId: String): String = JSONObject()
        .put("requestId", requestId)
        .put("accepted", true)
        .toString()

    private fun commandStatusJson(requestId: String, state: CommandState): String = JSONObject()
        .put("requestId", requestId)
        .apply {
            when (state) {
                CommandState.Pending -> put("state", "PENDING")
                is CommandState.Succeeded -> put("state", "SUCCEEDED").put("responseJson", state.responseJson)
                is CommandState.Failed -> {
                    put("state", "FAILED").put("errorCode", state.errorCode)
                    state.serverRequestId?.let { put("serverRequestId", it) }
                }
            }
        }
        .toString()

    companion object {
        private const val MAX_PAIRING_REQUESTS = 16
        private const val MAX_COMMAND_REQUESTS = 32
    }
}
