package com.hotelalert.notificationreceiver

import com.hotelalert.notificationreceiver.network.HttpDeviceRequestCommandClient
import com.hotelalert.notificationreceiver.protocol.NativeRequestCommandException
import com.hotelalert.notificationreceiver.protocol.NativeRequestTargetStatus
import com.hotelalert.notificationreceiver.protocol.NativeRequestTransition
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL

class HttpDeviceRequestCommandClientTest {
    @Test
    fun `preserves only the safe server request id and error code from an error response`() = runTest {
        val connection = StubRequestConnection(
            500,
            """{"error":{"code":"INTERNAL_ERROR","requestId":"server-request-12345678","message":"private error","details":{"responsibleName":"private person","token":"secret"}}}"""
        )
        val error = runCatching {
            HttpDeviceRequestCommandClient { connection }.transition(
                "http://hotel.test", "device-1", "secret-token",
                NativeRequestTransition("request-1", NativeRequestTargetStatus.IN_PROGRESS, 2, "transition-1", "Taylor Morgan")
            )
        }.exceptionOrNull()

        assertEquals("INTERNAL_ERROR", (error as NativeRequestCommandException).errorCode)
        assertEquals("server-request-12345678", error.serverRequestId)
        assertFalse(error.message.orEmpty().contains("private error"))
        assertFalse(error.message.orEmpty().contains("Taylor Morgan"))
        assertFalse(error.message.orEmpty().contains("secret-token"))
    }

    @Test
    fun `drops an unsafe server request id from an error response`() = runTest {
        val connection = StubRequestConnection(
            500,
            """{"error":{"code":"INTERNAL_ERROR","requestId":"token value must not leak"}}"""
        )
        val error = runCatching {
            HttpDeviceRequestCommandClient { connection }.transition(
                "http://hotel.test", "device-1", "secret-token",
                NativeRequestTransition("request-1", NativeRequestTargetStatus.IN_PROGRESS, 2, "transition-1", "Taylor Morgan")
            )
        }.exceptionOrNull()

        assertNull((error as NativeRequestCommandException).serverRequestId)
    }
}

private class StubRequestConnection(
    private val responseStatus: Int,
    private val responseBody: String
) : HttpURLConnection(URL("http://hotel.test")) {
    override fun connect() = Unit
    override fun disconnect() = Unit
    override fun usingProxy(): Boolean = false
    override fun getResponseCode(): Int = responseStatus
    override fun getOutputStream(): OutputStream = ByteArrayOutputStream()
    override fun getErrorStream(): InputStream = ByteArrayInputStream(responseBody.toByteArray(Charsets.UTF_8))
}
