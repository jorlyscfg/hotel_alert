package com.hotelalert.notificationreceiver.storage

import android.content.Context
import android.util.AtomicFile
import com.hotelalert.notificationreceiver.protocol.DurableCursorStore
import com.hotelalert.notificationreceiver.protocol.ReceiverConfiguration
import com.hotelalert.notificationreceiver.protocol.ReceiverConfigurationStore
import com.hotelalert.notificationreceiver.protocol.PairingStateStore
import com.hotelalert.notificationreceiver.protocol.PairingStateRollback
import com.hotelalert.notificationreceiver.receiver.AreaSnapshotCacheCodec
import com.hotelalert.notificationreceiver.receiver.AreaSnapshotPersistence
import com.hotelalert.notificationreceiver.web.ServerOriginStore
import com.hotelalert.notificationreceiver.web.normalizeAndValidateServerOrigin
import java.io.File
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class AndroidKeyStoreDeviceTokenStore(
    private val context: Context,
    private val keyAlias: String = DEFAULT_KEY_ALIAS
) : DeviceTokenStore {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    override suspend fun read(): String? {
        val encoded = preferences.getString(TOKEN_KEY, null) ?: return null
        val separator = encoded.indexOf(':')
        if (separator <= 0 || separator == encoded.lastIndex) throw IllegalStateException("The protected device token is invalid.")
        val iv = decode(encoded.substring(0, separator))
        val ciphertext = decode(encoded.substring(separator + 1))
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_LENGTH_BITS, iv))
        return String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8)
    }

    override suspend fun write(token: String) {
        require(token.isNotBlank()) { "The device token must not be blank." }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        // Android Keystore requires the provider to generate the GCM IV for
        // encryption; supplying a caller-generated IV is rejected on Android 14.
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val ciphertext = cipher.doFinal(token.toByteArray(StandardCharsets.UTF_8))
        val encoded = "${encode(cipher.iv)}:${encode(ciphertext)}"
        check(preferences.edit().putString(TOKEN_KEY, encoded).commit()) {
            "The protected device token could not be persisted."
        }
    }

    override suspend fun clear() {
        check(preferences.edit().remove(TOKEN_KEY).commit()) {
            "The protected device token could not be cleared."
        }
    }

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
        val existing = keyStore.getKey(keyAlias, null) as? SecretKey
        if (existing != null) return existing
        val generator = KeyGenerator.getInstance("AES", ANDROID_KEY_STORE)
        generator.init(android.security.keystore.KeyGenParameterSpec.Builder(
            keyAlias,
            android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or android.security.keystore.KeyProperties.PURPOSE_DECRYPT
        ).setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
            .build())
        return generator.generateKey()
    }

    private fun encode(value: ByteArray): String = Base64.getEncoder().encodeToString(value)

    private fun decode(value: String): ByteArray = try {
        Base64.getDecoder().decode(value)
    } catch (error: IllegalArgumentException) {
        throw IllegalStateException("The protected device token is invalid.", error)
    }

    companion object {
        private const val ANDROID_KEY_STORE = "AndroidKeyStore"
        private const val DEFAULT_KEY_ALIAS = "hotel-alert-device-token"
        private const val PREFERENCES_NAME = "hotel_alert_secure_receiver"
        private const val TOKEN_KEY = "encrypted_device_token"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val TAG_LENGTH_BITS = 128
    }
}

class AndroidReceiverConfigurationStore(context: Context) : ReceiverConfigurationStore {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    override fun read(): ReceiverConfiguration? {
        val serverOrigin = preferences.getString(SERVER_ORIGIN_KEY, null) ?: return null
        val deviceId = preferences.getString(DEVICE_ID_KEY, null) ?: return null
        val clientInstanceId = preferences.getString(CLIENT_INSTANCE_ID_KEY, null) ?: return null
        val clientVersion = preferences.getString(CLIENT_VERSION_KEY, null) ?: return null
        return ReceiverConfiguration(serverOrigin, deviceId, clientInstanceId, clientVersion)
    }

    override fun write(configuration: ReceiverConfiguration) {
        require(configuration.serverOrigin.startsWith("http://") || configuration.serverOrigin.startsWith("https://")) {
            "The server origin must use HTTP or HTTPS."
        }
        check(preferences.edit()
            .putString(SERVER_ORIGIN_KEY, configuration.serverOrigin.trimEnd('/'))
            .putString(DEVICE_ID_KEY, configuration.deviceId)
            .putString(CLIENT_INSTANCE_ID_KEY, configuration.clientInstanceId)
            .putString(CLIENT_VERSION_KEY, configuration.clientVersion)
            .commit()) {
            "The receiver configuration could not be persisted."
        }
    }

    override fun readReceiverRunIntent(): Boolean? = if (preferences.contains(RECEIVER_RUN_INTENT_KEY)) {
        preferences.getBoolean(RECEIVER_RUN_INTENT_KEY, false)
    } else {
        null
    }

    override fun writeReceiverRunIntent(enabled: Boolean) {
        check(preferences.edit().putBoolean(RECEIVER_RUN_INTENT_KEY, enabled).commit()) {
            "The receiver run intent could not be persisted."
        }
    }

    override fun clearReceiverRunIntent() {
        check(preferences.edit().remove(RECEIVER_RUN_INTENT_KEY).commit()) {
            "The receiver run intent could not be cleared."
        }
    }

    override fun clearDeviceAssignment() {
        check(preferences.edit()
            .remove(DEVICE_ID_KEY)
            .remove(CLIENT_INSTANCE_ID_KEY)
            .remove(CLIENT_VERSION_KEY)
            .remove(RECEIVER_RUN_INTENT_KEY)
            .commit()) {
            "The receiver device assignment could not be cleared."
        }
    }

    override fun clear() {
        check(preferences.edit()
            .remove(SERVER_ORIGIN_KEY)
            .remove(DEVICE_ID_KEY)
            .remove(CLIENT_INSTANCE_ID_KEY)
            .remove(CLIENT_VERSION_KEY)
            .remove(RECEIVER_RUN_INTENT_KEY)
            .commit()) {
            "The receiver configuration could not be cleared."
        }
    }

    companion object {
        private const val PREFERENCES_NAME = "hotel_alert_receiver"
        private const val SERVER_ORIGIN_KEY = "server_origin"
        private const val DEVICE_ID_KEY = "device_id"
        private const val CLIENT_INSTANCE_ID_KEY = "client_instance_id"
        private const val CLIENT_VERSION_KEY = "client_version"
        private const val RECEIVER_RUN_INTENT_KEY = "receiver_run_enabled"
    }
}

class AndroidPairingStateStore(
    private val configurationStore: ReceiverConfigurationStore,
    private val tokenStore: DeviceTokenStore
) : PairingStateStore {
    override fun readConfiguration(): ReceiverConfiguration? = configurationStore.read()

    override suspend fun replace(configuration: ReceiverConfiguration, token: String): PairingStateRollback {
        val previousConfiguration = configurationStore.read()
        val previousRunIntent = configurationStore.readReceiverRunIntent()
        val previousToken = tokenStore.read()
        try {
            tokenStore.write(token)
            configurationStore.write(configuration)
        } catch (error: Throwable) {
            runCatching {
                if (previousToken == null) tokenStore.clear() else tokenStore.write(previousToken)
            }
            runCatching {
                if (previousConfiguration == null) configurationStore.clear() else configurationStore.write(previousConfiguration)
            }
            throw error
        }
        return PairingStateRollback {
            runCatching {
                if (previousToken == null) tokenStore.clear() else tokenStore.write(previousToken)
            }
            runCatching {
                if (previousConfiguration == null) configurationStore.clear() else configurationStore.write(previousConfiguration)
            }
            runCatching {
                if (previousRunIntent == null) configurationStore.clearReceiverRunIntent()
                else configurationStore.writeReceiverRunIntent(previousRunIntent)
            }
        }
    }
}

class AndroidServerOriginStore(context: Context) : ServerOriginStore {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    override fun read(): String? = preferences.getString(SERVER_ORIGIN_KEY, null)

    override fun write(serverOrigin: String) {
        val normalizedOrigin = normalizeAndValidateServerOrigin(serverOrigin)
        check(preferences.edit().putString(SERVER_ORIGIN_KEY, normalizedOrigin).commit()) {
            "The WebView server origin could not be persisted."
        }
    }

    companion object {
        private const val PREFERENCES_NAME = "hotel_alert_webview"
        private const val SERVER_ORIGIN_KEY = "server_origin"
    }
}

class AtomicFileCursorStore(context: Context) : DurableCursorStore {
    private val file = AtomicFile(File(context.filesDir, "hotel-alert-event-cursor"))
    private val mutex = Mutex()
    @Volatile
    private var current: Long = readCursor()

    override val lastSeenEventSequence: Long
        get() = current

    override suspend fun advanceTo(eventSequence: Long) = mutex.withLock {
        require(eventSequence >= current) { "The durable event cursor cannot regress." }
        if (eventSequence == current) return
        val output = file.startWrite()
        try {
            output.bufferedWriter(StandardCharsets.UTF_8).use { writer ->
                writer.write(eventSequence.toString())
                writer.newLine()
            }
            file.finishWrite(output)
            current = eventSequence
        } catch (error: Throwable) {
            file.failWrite(output)
            throw IllegalStateException("The durable event cursor could not be persisted.", error)
        }
    }

    override suspend fun clear() = mutex.withLock {
        file.delete()
        current = 0
    }

    private fun readCursor(): Long {
        return try {
            file.openRead().bufferedReader(StandardCharsets.UTF_8).use { reader ->
                val value = reader.readLine()?.trim()?.toLongOrNull()
                require(value != null && value >= 0) { "The durable event cursor is invalid." }
                value
            }
        } catch (error: java.io.FileNotFoundException) {
            0
        }
    }
}

class AtomicFileAreaSnapshotPersistence(context: Context) : AreaSnapshotPersistence {
    private val file = AtomicFile(File(context.filesDir, "hotel-alert-area-snapshot"))
    private val lock = Any()

    override fun read(expectedDeviceId: String): String? = synchronized(lock) {
        try {
            val raw = file.openRead().bufferedReader(StandardCharsets.UTF_8).use { it.readText() }
            AreaSnapshotCacheCodec.decode(raw, expectedDeviceId) ?: run {
                file.delete()
                null
            }
        } catch (_: java.io.FileNotFoundException) {
            null
        } catch (_: Throwable) {
            file.delete()
            null
        }
    }

    override fun write(deviceId: String, snapshotJson: String) = synchronized(lock) {
        val output = file.startWrite()
        try {
            output.bufferedWriter(StandardCharsets.UTF_8).use { writer ->
                writer.write(AreaSnapshotCacheCodec.encode(deviceId, snapshotJson))
                writer.newLine()
            }
            file.finishWrite(output)
        } catch (error: Throwable) {
            file.failWrite(output)
            throw IllegalStateException("The AREA device snapshot could not be persisted.", error)
        }
    }

    override fun clear() = synchronized(lock) {
        file.delete()
        Unit
    }
}
