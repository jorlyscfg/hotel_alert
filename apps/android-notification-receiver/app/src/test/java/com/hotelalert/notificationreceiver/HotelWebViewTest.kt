package com.hotelalert.notificationreceiver

import com.hotelalert.notificationreceiver.ui.webViewEntryUrl
import org.junit.Assert.assertEquals
import org.junit.Test

class HotelWebViewTest {
    @Test
    fun `notification start request id survives in the webview entry route`() {
        assertEquals(
            "https://hotel.test/?__hotel_alert_webview_reload=reload-1&startRequestId=request-42",
            webViewEntryUrl("https://hotel.test", "reload-1", "request-42")
        )
    }
}
