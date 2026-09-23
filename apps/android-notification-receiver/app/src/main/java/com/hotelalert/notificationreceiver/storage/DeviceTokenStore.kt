package com.hotelalert.notificationreceiver.storage

interface DeviceTokenStore {
    suspend fun read(): String?

    suspend fun write(token: String)

    suspend fun clear()
}
