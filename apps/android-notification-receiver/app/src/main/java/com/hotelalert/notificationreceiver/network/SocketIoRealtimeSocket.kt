package com.hotelalert.notificationreceiver.network

import com.hotelalert.notificationreceiver.protocol.RealtimeSocket
import com.hotelalert.notificationreceiver.protocol.RealtimeSocketFactory
import io.socket.client.IO
import io.socket.client.Socket
import io.socket.emitter.Emitter
import org.json.JSONObject

class SocketIoRealtimeSocketFactory : RealtimeSocketFactory {
    override fun create(serverOrigin: String, auth: JSONObject): RealtimeSocket {
        val options = IO.Options().apply {
            reconnection = true
            path = "/socket.io"
            this.auth = toSocketAuth(auth)
        }
        return SocketIoRealtimeSocket(IO.socket("${serverOrigin.trimEnd('/')}/realtime", options))
    }
}

private class SocketIoRealtimeSocket(private val socket: Socket) : RealtimeSocket {
    private val listeners = mutableMapOf<Pair<String, (Any?) -> Unit>, Emitter.Listener>()

    override val connected: Boolean
        get() = socket.connected()

    override fun on(eventName: String, listener: (Any?) -> Unit): RealtimeSocket {
        val emitterListener = Emitter.Listener { args -> listener(args.firstOrNull()) }
        listeners[eventName to listener] = emitterListener
        socket.on(eventName, emitterListener)
        return this
    }

    override fun off(eventName: String, listener: (Any?) -> Unit): RealtimeSocket {
        val emitterListener = listeners.remove(eventName to listener) ?: return this
        socket.off(eventName, emitterListener)
        return this
    }

    override fun updateAuth(auth: JSONObject): RealtimeSocket {
        // The Java client exposes auth only through IO.Options at construction time.
        // Numeric cursor/config values are sent in connection.sync instead; the
        // string credentials remain unchanged for the lifetime of this socket.
        return this
    }

    override fun emit(eventName: String, payload: JSONObject, acknowledgement: (JSONObject?) -> Unit): RealtimeSocket {
        socket.emit(eventName, arrayOf(payload), io.socket.client.Ack { args ->
            acknowledgement(if (args.isNotEmpty()) args[0] as? JSONObject else null)
        })
        return this
    }

    override fun connect(): RealtimeSocket {
        socket.connect()
        return this
    }

    override fun disconnect(): RealtimeSocket {
        socket.disconnect()
        return this
    }

    override fun disableReconnection() {
        socket.io().reconnection(false)
    }
}

internal fun toSocketAuth(auth: JSONObject): Map<String, String> = buildMap {
    for (key in listOf("deviceId", "deviceToken", "clientInstanceId", "clientVersion")) {
        val value = auth.optString(key).takeIf { it.isNotEmpty() }
        if (value != null) put(key, value)
    }
}
