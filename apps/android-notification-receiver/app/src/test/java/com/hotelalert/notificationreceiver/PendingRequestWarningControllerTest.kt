package com.hotelalert.notificationreceiver

import com.hotelalert.notificationreceiver.receiver.PendingRequestWarningController
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.ExperimentalCoroutinesApi
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class PendingRequestWarningControllerTest {
    @Test
    fun `overdue pending snapshot warns immediately and repeats until empty`() = runTest {
        var warningCount = 0
        val controller = PendingRequestWarningController(
            scope = this,
            nowMillis = { BASE_TIME + testScheduler.currentTime },
            onWarning = { warningCount++ }
        )

        controller.updateSnapshot(snapshot(request("request-1", "PENDING", BASE_TIME - INTERVAL_MS - 1)))
        runCurrent()
        assertEquals(1, warningCount)

        advanceTimeBy(INTERVAL_MS)
        runCurrent()
        assertEquals(2, warningCount)

        controller.updateSnapshot(snapshot())
        advanceTimeBy(INTERVAL_MS)
        runCurrent()
        assertEquals(2, warningCount)
        controller.dispose()
    }

    @Test
    fun `newly pending request resets deadline while same request refresh does not`() = runTest {
        var warningCount = 0
        val controller = PendingRequestWarningController(
            scope = this,
            nowMillis = { BASE_TIME + testScheduler.currentTime },
            onWarning = { warningCount++ }
        )

        controller.updateSnapshot(snapshot(request("request-1", "PENDING", BASE_TIME)))
        advanceTimeBy(60_000)
        controller.updateSnapshot(snapshot(request("request-1", "PENDING", BASE_TIME)))
        advanceTimeBy(60_000)
        controller.updateSnapshot(
            snapshot(
                request("request-1", "PENDING", BASE_TIME),
                request("request-2", "PENDING", BASE_TIME + 120_000)
            )
        )

        advanceTimeBy(60_000)
        runCurrent()
        assertEquals(0, warningCount)
        advanceTimeBy(INTERVAL_MS - 60_000 - 1)
        runCurrent()
        assertEquals(0, warningCount)
        advanceTimeBy(1)
        runCurrent()
        assertEquals(1, warningCount)

        controller.dispose()
    }

    @Test
    fun `non pending requests do not schedule reminders and null snapshot clears state`() = runTest {
        var warningCount = 0
        val controller = PendingRequestWarningController(
            scope = this,
            nowMillis = { BASE_TIME + testScheduler.currentTime },
            onWarning = { warningCount++ }
        )

        controller.updateSnapshot(snapshot(request("request-1", "IN_PROGRESS", BASE_TIME)))
        advanceTimeBy(INTERVAL_MS)
        runCurrent()
        assertEquals(0, warningCount)

        controller.updateSnapshot(snapshot(request("request-2", "PENDING", BASE_TIME + testScheduler.currentTime)))
        controller.updateSnapshot(null)
        advanceTimeBy(INTERVAL_MS)
        runCurrent()
        assertEquals(0, warningCount)
        controller.dispose()
    }

    @Test
    fun `snapshot server time avoids device clock skew`() = runTest {
        var warningCount = 0
        val controller = PendingRequestWarningController(
            scope = this,
            nowMillis = { BASE_TIME + 24 * 60 * 60 * 1000L + testScheduler.currentTime },
            onWarning = { warningCount++ }
        )

        controller.updateSnapshot(snapshotAt(BASE_TIME, request("request-1", "PENDING", BASE_TIME - 120_000)))
        advanceTimeBy(60_000 - 1)
        runCurrent()
        assertEquals(0, warningCount)
        advanceTimeBy(1)
        runCurrent()
        assertEquals(1, warningCount)
        controller.dispose()
    }

    private fun snapshot(vararg requests: String): String =
        """{"activeRequests":[${requests.joinToString(",") }]}"""

    private fun snapshotAt(serverTimeMillis: Long, vararg requests: String): String =
        """{"serverTime":"${Instant.ofEpochMilli(serverTimeMillis)}","activeRequests":[${requests.joinToString(",") }]}"""

    private fun request(id: String, status: String, createdAtMillis: Long): String =
        """{"id":"$id","status":"$status","createdAt":"${Instant.ofEpochMilli(createdAtMillis)}"}"""

    private companion object {
        const val INTERVAL_MS = 3 * 60 * 1000L
        val BASE_TIME = Instant.parse("2026-09-01T00:00:00Z").toEpochMilli()
    }
}
