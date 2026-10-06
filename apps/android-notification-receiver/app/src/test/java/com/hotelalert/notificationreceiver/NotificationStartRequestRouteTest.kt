package com.hotelalert.notificationreceiver

import com.hotelalert.notificationreceiver.protocol.notificationStartRequestId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NotificationStartRequestRouteTest {
    @Test
    fun `keeps the notification selected request id for the responsible form route`() {
        assertEquals("request-42", notificationStartRequestId(" request-42 "))
    }

    @Test
    fun `ignores a blank notification start request id`() {
        assertNull(notificationStartRequestId("  "))
    }
}
