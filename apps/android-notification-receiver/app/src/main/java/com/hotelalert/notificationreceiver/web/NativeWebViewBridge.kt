package com.hotelalert.notificationreceiver.web

import android.webkit.JavascriptInterface
import com.hotelalert.notificationreceiver.protocol.NativePairingCoordinator
import com.hotelalert.notificationreceiver.protocol.NativePairingRequest
import com.hotelalert.notificationreceiver.protocol.NativePairingResult
import com.hotelalert.notificationreceiver.protocol.NativeRequestCommandCoordinator
import com.hotelalert.notificationreceiver.protocol.NativeRequestCommandResult
import com.hotelalert.notificationreceiver.protocol.NativeRequestTransition
import com.hotelalert.notificationreceiver.receiver.NativeReceiverSnapshotStore
import com.hotelalert.notificationreceiver.receiver.ReceiverStatusStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

class HotelAlertWebBridge(
    private val scope: CoroutineScope? = null,
    private val pairingCoordinator: NativePairingCoordinator? = null,
    private val snapshotStore: NativeReceiverSnapshotStore? = null,
    private val statusStore: ReceiverStatusStore? = null,
    private val commandCoordinator: NativeRequestCommandCoordinator? = null
) {
    private sealed class PairingState {
        data object Pending : PairingState()
        data class Succeeded(val deviceId: String) : PairingState()
        data class Failed(val errorCode: String) : PairingState()
    }

    private val pairingStates = linkedMapOf<String, PairingState>()

    private sealed class CommandState {
        data object Pending : CommandState()
        data class Succeeded(val responseJson: String) : CommandState()
        data class Failed(val errorCode: String) : CommandState()
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
                    is NativeRequestCommandResult.Failure -> CommandState.Failed(result.errorCode)
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

    private val isEnabled: Boolean
        get() = scope != null && pairingCoordinator != null && snapshotStore != null && statusStore != null

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
                is CommandState.Failed -> put("state", "FAILED").put("errorCode", state.errorCode)
            }
        }
        .toString()

    companion object {
        private const val MAX_PAIRING_REQUESTS = 16
        private const val MAX_COMMAND_REQUESTS = 32
    }
}
