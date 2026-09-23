package com.hotelalert.notificationreceiver

import com.hotelalert.notificationreceiver.network.HttpDeviceSnapshotClient
import com.hotelalert.notificationreceiver.protocol.safeErrorCode
import kotlinx.coroutines.test.runTest
import org.junit.BeforeClass
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLConnection
import java.net.URLStreamHandler
import java.net.URLStreamHandlerFactory

class HttpDeviceSnapshotClientTest {
    @Test
    fun preservesTheStructuredCodeFromAnUnauthorizedSnapshotResponse() = runTest {
        assertSnapshotErrorCode(401, "AUTH_REQUIRED")
    }

    @Test
    fun preservesTheStructuredCodeFromAForbiddenSnapshotResponse() = runTest {
        assertSnapshotErrorCode(403, "FORBIDDEN_ASSIGNMENT")
    }

    @Test
    fun preservesTheStructuredCodeFromANonAuthenticationSnapshotResponse() = runTest {
        assertSnapshotErrorCode(500, "INTERNAL_ERROR")
    }

    private suspend fun assertSnapshotErrorCode(status: Int, errorCode: String) {
        val body = """
            {"error":{"code":"$errorCode","message":"safe test message","requestId":"request-1"}}
        """.trimIndent()
        StubHttpResponses.current = StubHttpResponse(status, body)
        val error = try {
            HttpDeviceSnapshotClient().fetch(
                serverOrigin = "http://snapshot.test",
                deviceId = "device-1",
                token = "test-token"
            )
            throw AssertionError("Expected the snapshot request to fail")
        } catch (expected: IllegalStateException) {
            expected
        }

        assertEquals(errorCode, safeErrorCode(error))
    }

    companion object {
        @JvmStatic
        @BeforeClass
        fun installHttpHandler() {
            URL.setURLStreamHandlerFactory(object : URLStreamHandlerFactory {
                override fun createURLStreamHandler(protocol: String): URLStreamHandler? {
                    if (protocol != "http") return null
                    return object : URLStreamHandler() {
                        override fun openConnection(url: URL): URLConnection = StubHttpURLConnection(url)
                    }
                }
            })
        }
    }
}

private object StubHttpResponses {
    var current = StubHttpResponse(500, "")
}

private data class StubHttpResponse(val status: Int, val body: String)

private class StubHttpURLConnection(url: URL) : HttpURLConnection(url) {
    override fun connect() = Unit

    override fun disconnect() = Unit

    override fun usingProxy(): Boolean = false

    override fun getResponseCode(): Int = StubHttpResponses.current.status

    override fun getInputStream(): InputStream = ByteArrayInputStream(StubHttpResponses.current.body.toByteArray(Charsets.UTF_8))

    override fun getErrorStream(): InputStream = ByteArrayInputStream(StubHttpResponses.current.body.toByteArray(Charsets.UTF_8))
}
