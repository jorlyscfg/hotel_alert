package com.hotelalert.notificationreceiver

import com.hotelalert.notificationreceiver.network.HttpRoomPresenceClient
import com.hotelalert.notificationreceiver.protocol.RoomPresenceException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

class HttpRoomPresenceClientTest {
    @Test
    fun `does not follow a redirect or send the ROOM bearer token to its target`() = runTest {
        val connection = RedirectingConnection(URL("http://hotel.test/api/v1/device/session"))
        val client = HttpRoomPresenceClient { connection }

        val error = try {
            client.fetchSession("http://hotel.test", "room-device", "room-secret")
            throw AssertionError("Expected the redirect response to be rejected")
        } catch (expected: RoomPresenceException) {
            expected
        }

        assertEquals(302, error.statusCode)
        assertEquals("REDIRECT_BLOCKED", error.errorCode)
        assertTrue(connection.instanceFollowRedirects.not())
        assertEquals(false, connection.redirectTargetReached)
        assertNull(connection.redirectTargetAuthorization)
    }
}

private class RedirectingConnection(url: URL) : HttpURLConnection(url) {
    var redirectTargetReached = false
        private set
    var redirectTargetAuthorization: String? = null
        private set

    override fun connect() = Unit

    override fun disconnect() = Unit

    override fun usingProxy(): Boolean = false

    override fun getResponseCode(): Int {
        if (instanceFollowRedirects) {
            redirectTargetReached = true
            redirectTargetAuthorization = getRequestProperty("Authorization")
            return HttpURLConnection.HTTP_OK
        }
        return HttpURLConnection.HTTP_MOVED_TEMP
    }

    override fun getErrorStream(): InputStream = ByteArrayInputStream(
        """{"error":{"code":"REDIRECT_BLOCKED"}}""".toByteArray(Charsets.UTF_8)
    )
}
