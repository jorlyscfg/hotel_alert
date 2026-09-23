package com.hotelalert.notificationreceiver.protocol

import org.json.JSONObject

object DeviceSnapshotParser {
    fun parseResponse(body: JSONObject, expectedDeviceId: String): DeviceSessionSnapshot {
        val requestId = body.requiredString("requestId")
            ?: throw IllegalArgumentException("The device session response is missing requestId.")
        if (requestId.isEmpty()) throw IllegalArgumentException("The device session response has an empty requestId.")
        val data = body.optJSONObject("data")
            ?: throw IllegalArgumentException("The device session response is missing data.")
        return parseSnapshot(data, expectedDeviceId).copy(payloadJson = data.toString())
    }

    fun parseSnapshot(data: JSONObject, expectedDeviceId: String): DeviceSessionSnapshot {
        val device = data.optJSONObject("device")
            ?: throw IllegalArgumentException("The device session snapshot is missing device.")
        val config = data.optJSONObject("config")
            ?: throw IllegalArgumentException("The device session snapshot is missing config.")
        val deviceId = device.requiredString("id")
            ?: throw IllegalArgumentException("The device session snapshot has an invalid device ID.")
        if (deviceId != expectedDeviceId) {
            throw IllegalArgumentException("The device session snapshot does not match the configured device.")
        }
        if (device.requiredString("assignmentMode") != "AREA" || !device.optBoolean("active", false)) {
            throw IllegalArgumentException("The device must have an active AREA assignment.")
        }
        val areaId = device.requiredString("areaId")
            ?: throw IllegalArgumentException("The device session snapshot has no area assignment.")
        if (config.requiredString("mode") != "AREA") {
            throw IllegalArgumentException("The device session snapshot has an inconsistent AREA assignment.")
        }
        val configArea = config.optJSONObject("area")
            ?: throw IllegalArgumentException("The device session snapshot is missing the configured area.")
        if (configArea.requiredString("id") != areaId) {
            throw IllegalArgumentException("The device session snapshot has an inconsistent AREA assignment.")
        }
        if (!data.has("activeRequests") || data.optJSONArray("activeRequests") == null) {
            throw IllegalArgumentException("The device session snapshot is missing activeRequests.")
        }
        val snapshotSequence = data.nonNegativeLong("snapshotSequence")
            ?: throw IllegalArgumentException("The device session snapshot has an invalid snapshot sequence.")
        val currentEventSequence = data.nonNegativeLong("currentEventSequence")
            ?: throw IllegalArgumentException("The device session snapshot has an invalid event sequence.")
        val deviceConfigVersion = data.positiveLong("deviceConfigVersion")
            ?: throw IllegalArgumentException("The device session snapshot has an invalid device configuration version.")
        val heartbeatIntervalMs = config.positiveLong("heartbeatIntervalMs")
            ?: throw IllegalArgumentException("The device session snapshot has an invalid heartbeat interval.")
        data.requiredString("serverTime")
            ?: throw IllegalArgumentException("The device session snapshot has an invalid server time.")
        val areaDisplayName = configArea.requiredString("displayName")
            ?: throw IllegalArgumentException("The device session snapshot has an invalid area display name.")
        if (snapshotSequence < 0) throw IllegalArgumentException("The device session snapshot has an invalid snapshot sequence.")
        return DeviceSessionSnapshot(
            deviceId = deviceId,
            areaId = areaId,
            areaDisplayName = areaDisplayName,
            currentEventSequence = currentEventSequence,
            deviceConfigVersion = deviceConfigVersion,
            heartbeatIntervalMs = heartbeatIntervalMs
        )
    }

    private fun JSONObject.requiredString(key: String): String? {
        val value = opt(key)
        return if (value is String && value.isNotEmpty()) value else null
    }

    private fun JSONObject.nonNegativeLong(key: String): Long? {
        val value = opt(key)
        if (value !is Number || value.toDouble() != value.toLong().toDouble()) return null
        return value.toLong().takeIf { it >= 0 }
    }

    private fun JSONObject.positiveLong(key: String): Long? = nonNegativeLong(key)?.takeIf { it > 0 }
}
