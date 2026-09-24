package com.hotelalert.notificationreceiver.storage

import android.content.Context
import com.hotelalert.notificationreceiver.protocol.RoomPresenceConfiguration
import com.hotelalert.notificationreceiver.protocol.RoomPresenceSession
import com.hotelalert.notificationreceiver.protocol.RoomPresenceSessionStore
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class AndroidRoomPresenceSessionStore(context: Context) : RoomPresenceSessionStore {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    private val activeTokenStore = AndroidKeyStoreDeviceTokenStore(
        context,
        keyAlias = KEY_ALIAS,
        preferencesName = PREFERENCES_NAME,
        tokenKey = ACTIVE_TOKEN_KEY
    )
    private val stagedTokenStore = AndroidKeyStoreDeviceTokenStore(
        context,
        keyAlias = KEY_ALIAS,
        preferencesName = PREFERENCES_NAME,
        tokenKey = STAGED_TOKEN_KEY
    )
    private val mutex = Mutex()

    override suspend fun read(): RoomPresenceSession? = mutex.withLock {
        val origin = preferences.getString(SERVER_ORIGIN_KEY, null) ?: return@withLock null
        val deviceId = preferences.getString(DEVICE_ID_KEY, null) ?: return@withLock null
        val clientVersion = preferences.getString(CLIENT_VERSION_KEY, null) ?: return@withLock null
        val token = activeTokenStore.read() ?: return@withLock null
        RoomPresenceSession(RoomPresenceConfiguration(origin, deviceId, clientVersion), token)
    }

    override suspend fun replace(configuration: RoomPresenceConfiguration, token: String) = mutex.withLock {
        val previous = readUnlocked()
        try {
            activeTokenStore.write(token)
            check(preferences.edit()
                .putString(SERVER_ORIGIN_KEY, configuration.serverOrigin)
                .putString(DEVICE_ID_KEY, configuration.deviceId)
                .putString(CLIENT_VERSION_KEY, configuration.clientVersion)
                .putBoolean(INVALIDATED_KEY, false)
                .commit()) { "The ROOM presence session could not be persisted." }
            stagedTokenStore.clear()
        } catch (error: Throwable) {
            runCatching {
                if (previous == null) activeTokenStore.clear() else activeTokenStore.write(previous.token)
            }
            throw error
        }
    }

    override suspend fun stageToken(token: String) = mutex.withLock {
        check(preferences.contains(DEVICE_ID_KEY)) { "The ROOM presence session is not configured." }
        stagedTokenStore.write(token)
    }

    override suspend fun readStagedToken(): String? = mutex.withLock { stagedTokenStore.read() }

    override suspend fun activateStagedToken(configuration: RoomPresenceConfiguration, expectedToken: String): Boolean = mutex.withLock {
        if (preferences.getString(SERVER_ORIGIN_KEY, null) != configuration.serverOrigin ||
            preferences.getString(DEVICE_ID_KEY, null) != configuration.deviceId ||
            preferences.getString(CLIENT_VERSION_KEY, null) != configuration.clientVersion
        ) return@withLock false
        val staged = stagedTokenStore.read() ?: return@withLock false
        if (staged != expectedToken) return@withLock false
        activeTokenStore.write(staged)
        stagedTokenStore.clear()
        true
    }

    override suspend fun clear(invalidated: Boolean) = mutex.withLock {
        activeTokenStore.clear()
        stagedTokenStore.clear()
        check(preferences.edit()
            .remove(SERVER_ORIGIN_KEY)
            .remove(DEVICE_ID_KEY)
            .remove(CLIENT_VERSION_KEY)
            .putBoolean(INVALIDATED_KEY, invalidated)
            .commit()) { "The ROOM presence session could not be cleared." }
    }

    override fun wasInvalidated(): Boolean = preferences.getBoolean(INVALIDATED_KEY, false)

    private suspend fun readUnlocked(): RoomPresenceSession? {
        val origin = preferences.getString(SERVER_ORIGIN_KEY, null) ?: return null
        val deviceId = preferences.getString(DEVICE_ID_KEY, null) ?: return null
        val version = preferences.getString(CLIENT_VERSION_KEY, null) ?: return null
        val token = activeTokenStore.read() ?: return null
        return RoomPresenceSession(RoomPresenceConfiguration(origin, deviceId, version), token)
    }

    companion object {
        private const val PREFERENCES_NAME = "hotel_alert_room_presence"
        private const val KEY_ALIAS = "hotel-alert-room-presence"
        private const val SERVER_ORIGIN_KEY = "server_origin"
        private const val DEVICE_ID_KEY = "device_id"
        private const val CLIENT_VERSION_KEY = "client_version"
        private const val ACTIVE_TOKEN_KEY = "active_device_token"
        private const val STAGED_TOKEN_KEY = "staged_device_token"
        private const val INVALIDATED_KEY = "assignment_invalidated"
    }
}
