package com.hotelalert.notificationreceiver

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MainActivityTest {
    @Test
    fun `opens the native diagnostics screen only for explicit diagnostics intents`() {
        assertTrue(shouldShowReceiverDiagnostics(showDiagnostics = true))
        assertFalse(shouldShowReceiverDiagnostics(hasEventId = true, hasRequestId = true, hasAreaId = true))
        assertFalse(shouldShowReceiverDiagnostics())
    }
}
