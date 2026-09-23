package com.hotelalert.notificationreceiver

import com.hotelalert.notificationreceiver.notification.NotificationMapper
import com.hotelalert.notificationreceiver.protocol.RequestNotification
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationSurfacesTest {
    @Test
    fun audibleFallbackIsLimitedToBackgroundCreatedRequests() {
        val created = notification("request.created")
        val updated = notification("request.updated")

        assertTrue(NotificationMapper.shouldPlayAudibleFallback(created, appInForeground = false))
        assertFalse(NotificationMapper.shouldPlayAudibleFallback(created, appInForeground = true))
        assertFalse(NotificationMapper.shouldPlayAudibleFallback(updated, appInForeground = false))
    }

    @Test
    fun bubbleContentKeepsTheExistingRequestAction() {
        val content = NotificationMapper.map(notification("request.created"))

        assertTrue(content.action.name == "START_REQUEST")
        assertTrue(content.metadata["requestId"] == "request-1")
        assertTrue(content.expandedText.contains("Room 101"))
        assertEquals("hotel-alert-request-request-1", NotificationMapper.bubbleShortcutId(content))
    }

    @Test
    fun bubbleShortcutUsesTheRequestIdentityRatherThanTheEventIdentity() {
        val content = NotificationMapper.map(notification("request.created"))

        assertEquals("hotel-alert-request-request-1", NotificationMapper.bubbleShortcutId(content))
    }

    private fun notification(eventName: String): RequestNotification = RequestNotification(
        eventName = eventName,
        eventId = "event-surfaces",
        eventSequence = 1,
        occurredAt = "2026-09-19T00:00:00Z",
        request = requestSnapshot("area-a")
    )
}
