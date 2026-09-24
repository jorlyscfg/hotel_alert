package com.hotelalert.notificationreceiver.storage

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

internal data class RoomMaintenancePinRecord(
    val salt: ByteArray,
    val verifier: ByteArray,
    val failedAttempts: Int = 0,
    val lockedUntilMillis: Long = 0L
)

internal sealed interface RoomMaintenancePinVerification {
    data class Accepted(val record: RoomMaintenancePinRecord) : RoomMaintenancePinVerification
    data class Rejected(
        val record: RoomMaintenancePinRecord,
        val attemptsRemaining: Int
    ) : RoomMaintenancePinVerification
    data class Locked(
        val record: RoomMaintenancePinRecord,
        val retryAfterMillis: Long
    ) : RoomMaintenancePinVerification
}

/** Pure PIN derivation and throttling rules. Android storage encrypts each complete record. */
internal object RoomMaintenancePinPolicy {
    const val DEFAULT_PIN = "0623"
    const val MAX_FAILURES = 5
    const val LOCKOUT_MILLIS = 60_000L

    private const val SALT_BYTES = 16
    private const val VERIFIER_BITS = 256
    private const val PBKDF2_ITERATIONS = 120_000

    fun isValidPin(pin: String): Boolean = pin.length == 4 && pin.all { it in '0'..'9' }

    fun createDefaultRecord(): RoomMaintenancePinRecord = createRecord(DEFAULT_PIN)

    fun createRecord(pin: String): RoomMaintenancePinRecord {
        require(isValidPin(pin)) { "The maintenance PIN must contain exactly four digits." }
        val salt = ByteArray(SALT_BYTES).also(SecureRandom()::nextBytes)
        return RoomMaintenancePinRecord(salt = salt, verifier = derive(pin, salt))
    }

    fun changePin(record: RoomMaintenancePinRecord, newPin: String): RoomMaintenancePinRecord {
        require(isValidPin(newPin)) { "The maintenance PIN must contain exactly four digits." }
        return createRecord(newPin).copy(
            failedAttempts = record.failedAttempts,
            lockedUntilMillis = record.lockedUntilMillis
        )
    }

    fun verify(
        record: RoomMaintenancePinRecord,
        suppliedPin: String,
        nowMillis: Long
    ): RoomMaintenancePinVerification {
        val remainingLockout = record.lockedUntilMillis - nowMillis
        if (remainingLockout > 0) {
            return RoomMaintenancePinVerification.Locked(record, remainingLockout)
        }

        val baseRecord = if (record.lockedUntilMillis > 0L) {
            record.copy(failedAttempts = 0, lockedUntilMillis = 0L)
        } else {
            record
        }
        val matches = isValidPin(suppliedPin) && MessageDigest.isEqual(
            baseRecord.verifier,
            derive(suppliedPin, baseRecord.salt)
        )
        if (matches) {
            return RoomMaintenancePinVerification.Accepted(
                baseRecord.copy(failedAttempts = 0, lockedUntilMillis = 0L)
            )
        }

        val failedAttempts = baseRecord.failedAttempts + 1
        if (failedAttempts >= MAX_FAILURES) {
            val lockedRecord = baseRecord.copy(
                failedAttempts = failedAttempts,
                lockedUntilMillis = nowMillis + LOCKOUT_MILLIS
            )
            return RoomMaintenancePinVerification.Locked(lockedRecord, LOCKOUT_MILLIS)
        }

        val rejectedRecord = baseRecord.copy(failedAttempts = failedAttempts)
        return RoomMaintenancePinVerification.Rejected(
            rejectedRecord,
            MAX_FAILURES - failedAttempts
        )
    }

    private fun derive(pin: String, salt: ByteArray): ByteArray {
        val password = pin.toCharArray()
        val spec = PBEKeySpec(password, salt, PBKDF2_ITERATIONS, VERIFIER_BITS)
        return try {
            SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
                .generateSecret(spec)
                .encoded
        } finally {
            spec.clearPassword()
            password.fill('\u0000')
        }
    }
}

internal object RoomMaintenancePinRecordCodec {
    private const val FORMAT_VERSION = 1
    private const val SALT_BYTES = 16
    private const val VERIFIER_BYTES = 32

    fun encode(record: RoomMaintenancePinRecord): ByteArray = ByteArrayOutputStream().use { bytes ->
        DataOutputStream(bytes).use { output ->
            output.writeInt(FORMAT_VERSION)
            output.writeInt(record.failedAttempts)
            output.writeLong(record.lockedUntilMillis)
            output.writeInt(record.salt.size)
            output.write(record.salt)
            output.writeInt(record.verifier.size)
            output.write(record.verifier)
        }
        bytes.toByteArray()
    }

    fun decode(encoded: ByteArray): RoomMaintenancePinRecord =
        DataInputStream(ByteArrayInputStream(encoded)).use { input ->
            require(input.readInt() == FORMAT_VERSION) { "The protected maintenance PIN version is invalid." }
            val failedAttempts = input.readInt().also {
                require(it in 0..RoomMaintenancePinPolicy.MAX_FAILURES)
            }
            val lockedUntilMillis = input.readLong().also { require(it >= 0L) }
            val saltLength = input.readInt().also { require(it == SALT_BYTES) }
            val salt = ByteArray(saltLength).also(input::readFully)
            val verifierLength = input.readInt().also { require(it == VERIFIER_BYTES) }
            val verifier = ByteArray(verifierLength).also(input::readFully)
            require(input.available() == 0) { "The protected maintenance PIN contains trailing data." }
            RoomMaintenancePinRecord(salt, verifier, failedAttempts, lockedUntilMillis)
        }
}
