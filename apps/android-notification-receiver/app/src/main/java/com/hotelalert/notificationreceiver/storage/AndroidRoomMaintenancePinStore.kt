package com.hotelalert.notificationreceiver.storage

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Stores the salted PIN verifier and throttle state as an Android Keystore-encrypted record. */
internal class AndroidRoomMaintenancePinStore(context: Context) {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    @Synchronized
    fun verify(pin: String, nowMillis: Long): RoomMaintenancePinVerification {
        val record = readRecord() ?: RoomMaintenancePinPolicy.createDefaultRecord().also(::writeRecord)
        val result = RoomMaintenancePinPolicy.verify(record, pin, nowMillis)
        val updated = when (result) {
            is RoomMaintenancePinVerification.Accepted -> result.record
            is RoomMaintenancePinVerification.Rejected -> result.record
            is RoomMaintenancePinVerification.Locked -> result.record
        }
        writeRecord(updated)
        return result
    }

    @Synchronized
    fun changePin(newPin: String) {
        val current = readRecord() ?: RoomMaintenancePinPolicy.createDefaultRecord()
        writeRecord(RoomMaintenancePinPolicy.changePin(current, newPin))
    }

    private fun readRecord(): RoomMaintenancePinRecord? {
        val encoded = preferences.getString(RECORD_KEY, null) ?: return null
        val separator = encoded.indexOf(':')
        check(separator > 0 && separator < encoded.lastIndex) { "The protected maintenance PIN is invalid." }
        val iv = decode(encoded.substring(0, separator))
        val ciphertext = decode(encoded.substring(separator + 1))
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_LENGTH_BITS, iv))
        return RoomMaintenancePinRecordCodec.decode(cipher.doFinal(ciphertext))
    }

    private fun writeRecord(record: RoomMaintenancePinRecord) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        // Let Android Keystore generate the IV, including on Android 14+.
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val ciphertext = cipher.doFinal(RoomMaintenancePinRecordCodec.encode(record))
        val encoded = "${Base64.encodeToString(cipher.iv, Base64.NO_WRAP)}:${Base64.encodeToString(ciphertext, Base64.NO_WRAP)}"
        check(preferences.edit().putString(RECORD_KEY, encoded).commit()) {
            "The protected maintenance PIN could not be persisted."
        }
    }

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance("AES", ANDROID_KEY_STORE).run {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build()
            )
            generateKey()
        }
    }

    private fun decode(value: String): ByteArray = try {
        Base64.decode(value, Base64.NO_WRAP)
    } catch (error: IllegalArgumentException) {
        throw IllegalStateException("The protected maintenance PIN is invalid.", error)
    }

    companion object {
        private const val ANDROID_KEY_STORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "hotel-alert-room-maintenance-pin"
        private const val PREFERENCES_NAME = "hotel_alert_room_maintenance"
        private const val RECORD_KEY = "encrypted_pin_record"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val TAG_LENGTH_BITS = 128
    }
}
