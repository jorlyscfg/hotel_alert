package com.hotelalert.notificationreceiver.receiver

import com.hotelalert.notificationreceiver.protocol.DeviceSnapshotParser
import com.hotelalert.notificationreceiver.protocol.ReceiverConfigurationStore
import org.json.JSONObject

interface AreaSnapshotPersistence {
    fun read(expectedDeviceId: String): String?

    fun write(deviceId: String, snapshotJson: String)

    fun clear()
}

class NativeReceiverSnapshotStore(
    private val configurationStore: ReceiverConfigurationStore? = null,
    private val persistence: AreaSnapshotPersistence? = null
) {
    @Volatile
    private var snapshotJson: String? = restore()

    @Synchronized
    fun update(snapshot: String?) {
        if (configurationStore == null && persistence == null) {
            snapshotJson = snapshot
            return
        }
        val deviceId = configurationStore?.read()?.deviceId
        val validatedJson = snapshot?.let { validate(it, deviceId) }
        if (validatedJson == null || deviceId == null) {
            snapshotJson = null
            persistence?.clear()
            return
        }

        try {
            persistence?.write(deviceId, validatedJson)
        } catch (error: Throwable) {
            // Keep the active session usable if local storage is temporarily unavailable,
            // but do not leave an older snapshot eligible for restoration.
            runCatching { persistence?.clear() }
        }
        snapshotJson = validatedJson
    }

    @Synchronized
    fun read(): String? {
        val current = snapshotJson ?: return null
        if (configurationStore == null) return current
        val deviceId = configurationStore.read()?.deviceId
        val validatedJson = validate(current, deviceId)
        if (validatedJson == null) {
            snapshotJson = null
            persistence?.clear()
            return null
        }
        return validatedJson
    }

    @Synchronized
    private fun restore(): String? {
        val snapshotPersistence = persistence ?: return null
        val deviceId = configurationStore?.read()?.deviceId
        if (configurationStore == null || deviceId.isNullOrBlank()) {
            snapshotPersistence.clear()
            return null
        }
        val cached = snapshotPersistence.read(deviceId) ?: return null
        return validate(cached, deviceId) ?: run {
            snapshotPersistence.clear()
            null
        }
    }

    private fun validate(rawJson: String, expectedDeviceId: String?): String? {
        if (expectedDeviceId.isNullOrBlank()) return null
        return runCatching {
            val json = JSONObject(rawJson)
            DeviceSnapshotParser.parseSnapshot(json, expectedDeviceId)
            json.toString()
        }.getOrNull()
    }
}

internal object AreaSnapshotCacheCodec {
    fun encode(deviceId: String, snapshotJson: String): String = JSONObject()
        .put("deviceId", deviceId)
        .put("snapshot", JSONObject(snapshotJson))
        .toString()

    fun decode(raw: String, expectedDeviceId: String): String? = runCatching {
        val envelope = JSONObject(raw)
        if (envelope.optString("deviceId") != expectedDeviceId) return null
        envelope.optJSONObject("snapshot")?.toString()
    }.getOrNull()
}
