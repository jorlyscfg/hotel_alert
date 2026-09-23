package com.hotelalert.notificationreceiver

import com.hotelalert.notificationreceiver.web.normalizeAndValidateServerOrigin
import com.hotelalert.notificationreceiver.web.NativeWebViewBridgeContract
import com.hotelalert.notificationreceiver.web.ServerOriginStore
import com.hotelalert.notificationreceiver.web.ValidatedServerOriginStore
import com.hotelalert.notificationreceiver.web.WebViewNavigationPolicy
import com.hotelalert.notificationreceiver.ui.webViewEntryUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class WebViewBoundaryTest {
    @Test
    fun `webview entry URL receives a cache-busting query`() {
        assertEquals(
            "http://hotel.test:3000/?__hotel_alert_webview_reload=abc123",
            webViewEntryUrl(" http://hotel.test:3000/ ", "abc123")
        )
    }

    @Test
    fun `server origin is canonicalized and rejects non-origin paths`() {
        assertEquals(
            "http://hotel.test:3000",
            normalizeAndValidateServerOrigin("  http://hotel.test:3000/  ")
        )

        assertThrows(IllegalArgumentException::class.java) {
            normalizeAndValidateServerOrigin("https://hotel.test/console")
        }
        listOf(
            "https://user:password@hotel.test",
            "https://hotel.test?redirect=other.test",
            "https://hotel.test#other.test",
            "javascript:alert(1)",
            "https://"
        ).forEach { invalidOrigin ->
            assertThrows(IllegalArgumentException::class.java) {
                normalizeAndValidateServerOrigin(invalidOrigin)
            }
        }
    }

    @Test
    fun `validated origin store persists only the canonical origin`() {
        val delegate = RecordingOriginStore()
        val store = ValidatedServerOriginStore(delegate)

        store.write(" https://hotel.test:443/ ")

        assertEquals("https://hotel.test", delegate.origin)
        assertThrows(IllegalArgumentException::class.java) {
            store.write("https://hotel.test/console")
        }
    }

    @Test
    fun `navigation policy allows only the configured origin and no external intents`() {
        val policy = WebViewNavigationPolicy("https://hotel.test")

        assertTrue(policy.isAllowedNavigation("https://hotel.test/admin?tab=setup"))
        assertTrue(policy.isAllowedNavigation("https://hotel.test:443/"))
        assertFalse(policy.isAllowedNavigation("https://other.test/admin"))
        assertFalse(policy.isAllowedNavigation("https://hotel.test.evil/admin"))
        assertFalse(policy.isAllowedNavigation("http://hotel.test/admin"))
        assertFalse(policy.isAllowedNavigation("javascript:alert(1)"))
        assertFalse(policy.isExternalIntentAllowed("intent://other.test/#Intent;scheme=https;end"))
        assertFalse(policy.isExternalIntentAllowed("https://other.test/admin"))
    }

    @Test
    fun `native bridge contract exposes no device credentials`() {
        val capabilities = NativeWebViewBridgeContract.capabilitiesJson

        assertEquals("HotelAlertNative", NativeWebViewBridgeContract.name)
        assertTrue(capabilities.contains("\"bridgeVersion\":1"))
        assertFalse(capabilities.contains("deviceToken"))
        assertFalse(capabilities.contains("deviceId"))
    }

    private class RecordingOriginStore : ServerOriginStore {
        var origin: String? = null

        override fun read(): String? = origin

        override fun write(serverOrigin: String) {
            origin = serverOrigin
        }
    }
}
