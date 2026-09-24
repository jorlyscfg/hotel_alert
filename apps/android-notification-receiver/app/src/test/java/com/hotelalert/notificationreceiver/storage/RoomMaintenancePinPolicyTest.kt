package com.hotelalert.notificationreceiver.storage

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RoomMaintenancePinPolicyTest {
    @Test
    fun `default PIN is valid and can be verified without forcing a change`() {
        val record = RoomMaintenancePinPolicy.createDefaultRecord()

        val accepted = RoomMaintenancePinPolicy.verify(record, "0623", nowMillis = 1_000L)
        assertTrue(accepted is RoomMaintenancePinVerification.Accepted)
        assertTrue(RoomMaintenancePinPolicy.isValidPin("0623"))
        assertFalse(RoomMaintenancePinPolicy.isValidPin("623"))
        assertFalse(RoomMaintenancePinPolicy.isValidPin("12a4"))
    }

    @Test
    fun `failed attempts persist in the record and trigger a one-minute lockout`() {
        var record = RoomMaintenancePinPolicy.createDefaultRecord()
        repeat(RoomMaintenancePinPolicy.MAX_FAILURES - 1) { attempt ->
            val result = RoomMaintenancePinPolicy.verify(record, "0000", nowMillis = attempt * 100L)
            assertTrue(result is RoomMaintenancePinVerification.Rejected)
            record = (result as RoomMaintenancePinVerification.Rejected).record
        }

        val finalResult = RoomMaintenancePinPolicy.verify(record, "0000", nowMillis = 500L)
        assertTrue(finalResult is RoomMaintenancePinVerification.Locked)
        record = (finalResult as RoomMaintenancePinVerification.Locked).record
        val restored = RoomMaintenancePinRecordCodec.decode(RoomMaintenancePinRecordCodec.encode(record))

        val blocked = RoomMaintenancePinPolicy.verify(restored, "0623", nowMillis = 60_000L)
        assertTrue(blocked is RoomMaintenancePinVerification.Locked)
        assertEquals(500L, (blocked as RoomMaintenancePinVerification.Locked).retryAfterMillis)

        val afterLockout = RoomMaintenancePinPolicy.verify(
            restored,
            "0623",
            nowMillis = 500L + RoomMaintenancePinPolicy.LOCKOUT_MILLIS
        )
        assertTrue(afterLockout is RoomMaintenancePinVerification.Accepted)
    }

    @Test
    fun `changing the PIN is optional and replaces the verifier with a fresh salt`() {
        val defaultRecord = RoomMaintenancePinPolicy.createDefaultRecord()
        val changed = RoomMaintenancePinPolicy.changePin(defaultRecord, "9471")

        assertFalse(defaultRecord.salt.contentEquals(changed.salt))
        assertTrue(RoomMaintenancePinPolicy.verify(changed, "0623", 0L) is RoomMaintenancePinVerification.Rejected)
        assertTrue(RoomMaintenancePinPolicy.verify(changed, "9471", 1L) is RoomMaintenancePinVerification.Accepted)
    }

    @Test
    fun `PIN verifier and persistent lockout round-trip through the record codec`() {
        val record = RoomMaintenancePinPolicy.createDefaultRecord().copy(
            failedAttempts = 4,
            lockedUntilMillis = 123_456L
        )

        val restored = RoomMaintenancePinRecordCodec.decode(RoomMaintenancePinRecordCodec.encode(record))

        assertArrayEquals(record.salt, restored.salt)
        assertArrayEquals(record.verifier, restored.verifier)
        assertEquals(record.failedAttempts, restored.failedAttempts)
        assertEquals(record.lockedUntilMillis, restored.lockedUntilMillis)
    }
}
