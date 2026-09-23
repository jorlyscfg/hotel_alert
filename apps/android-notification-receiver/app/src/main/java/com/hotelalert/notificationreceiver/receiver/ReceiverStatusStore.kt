package com.hotelalert.notificationreceiver.receiver

import com.hotelalert.notificationreceiver.protocol.ReceiverState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class ReceiverStatusStore {
    private val _state = MutableStateFlow(ReceiverState.IDLE)
    val state: StateFlow<ReceiverState> = _state.asStateFlow()

    fun update(nextState: ReceiverState) {
        _state.value = nextState
    }
}
