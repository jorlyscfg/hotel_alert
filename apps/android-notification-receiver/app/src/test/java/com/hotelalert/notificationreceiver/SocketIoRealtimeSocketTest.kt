package com.hotelalert.notificationreceiver

import com.hotelalert.notificationreceiver.network.toSocketAuth
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class SocketIoRealtimeSocketTest {
    @Test
    fun `socket handshake contains only string credentials`() {
        val auth = JSONObject()
            .put("deviceId", "device-1")
            .put("deviceToken", "token-1")
            .put("clientInstanceId", "instance-1")
            .put("clientVersion", "0.1.0")
            .put("lastSeenEventSequence", 12)
            .put("deviceConfigVersion", 4)

        assertEquals(
            mapOf(
                "deviceId" to "device-1",
                "deviceToken" to "token-1",
                "clientInstanceId" to "instance-1",
                "clientVersion" to "0.1.0"
            ),
            toSocketAuth(auth)
        )
    }
}
