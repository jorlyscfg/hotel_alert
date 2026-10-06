package com.hotelalert.notificationreceiver

import com.hotelalert.notificationreceiver.network.HttpRoomPresenceClient
import com.hotelalert.notificationreceiver.network.parseRoomPresenceRetryAfterMs
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

    @Test
    fun `parses delta seconds and HTTP dates into a bounded retry delay`() {
        assertEquals(7_000L, parseRoomPresenceRetryAfterMs("7", nowMillis = 1_000L))
        assertEquals(9_000L, parseRoomPresenceRetryAfterMs("Thu, 01 Jan 1970 00:00:10 GMT", nowMillis = 1_000L))
        assertEquals(1_000L, parseRoomPresenceRetryAfterMs("0", nowMillis = 1_000L))
        assertEquals(300_000L, parseRoomPresenceRetryAfterMs("999999", nowMillis = 1_000L))
        assertNull(parseRoomPresenceRetryAfterMs("not-a-delay", nowMillis = 1_000L))
    }

    @Test
    fun `attaches Retry After only to rate limited ROOM responses`() = runTest {
        val limited = try {
            HttpRoomPresenceClient { ErrorResponseConnection(it, 429, "7") }
                .fetchSession("http://hotel.test", "room-device", "room-secret")
            throw AssertionError("Expected a rate-limit response")
        } catch (expected: RoomPresenceException) {
            expected
        }
        val unavailable = try {
            HttpRoomPresenceClient { ErrorResponseConnection(it, 503, "7") }
                .fetchSession("http://hotel.test", "room-device", "room-secret")
            throw AssertionError("Expected an unavailable response")
        } catch (expected: RoomPresenceException) {
            expected
        }

        assertEquals(7_000L, limited.retryAfterMs)
        assertNull(unavailable.retryAfterMs)
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

private class ErrorResponseConnection(
    url: URL,
    private val statusCode: Int,
    private val retryAfter: String
) : HttpURLConnection(url) {
    override fun connect() = Unit

    override fun disconnect() = Unit

    override fun usingProxy(): Boolean = false

    override fun getResponseCode(): Int = statusCode

    override fun getHeaderField(name: String): String? =
        if (name.equals("Retry-After", ignoreCase = true)) retryAfter else null

    override fun getErrorStream(): InputStream = ByteArrayInputStream(
        """{"error":{"code":"${if (statusCode == 429) "RATE_LIMITED" else "SERVICE_UNAVAILABLE"}"}}"""
            .toByteArray(Charsets.UTF_8)
    )
}
