package com.hotelalert.notificationreceiver.receiver

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant

internal const val PENDING_REQUEST_WARNING_INTERVAL_MS = 3 * 60 * 1000L

/** Schedules repeating reminders from authoritative AREA snapshots, independent of modal visibility. */
internal class PendingRequestWarningController(
    private val scope: CoroutineScope,
    private val nowMillis: () -> Long = System::currentTimeMillis,
    private val onWarning: () -> Unit
) {
    private data class PendingRequest(val id: String, val createdAtMillis: Long?)
    private data class PendingSnapshot(val requests: List<PendingRequest>, val serverTimeMillis: Long?)

    private val lock = Any()
    private val pendingRequests = linkedMapOf<String, Long?>()
    private var timerJob: Job? = null

    fun updateSnapshot(snapshotJson: String?) {
        if (snapshotJson == null) {
            update(emptyList(), nowMillis())
            return
        }
        val nextSnapshot = parsePendingRequests(snapshotJson) ?: return
        update(nextSnapshot.requests, nextSnapshot.serverTimeMillis ?: nowMillis())
    }

    fun dispose() {
        synchronized(lock) {
            pendingRequests.clear()
            timerJob?.cancel()
            timerJob = null
        }
    }

    private fun update(nextRequests: List<PendingRequest>, snapshotTimeMillis: Long) {
        synchronized(lock) {
            if (nextRequests.isEmpty()) {
                pendingRequests.clear()
                timerJob?.cancel()
                timerJob = null
                return
            }

            val nextById = nextRequests.associate { it.id to it.createdAtMillis }
            val newlyPending = nextById.filterKeys { it !in pendingRequests }
            pendingRequests.clear()
            pendingRequests.putAll(nextById)
            if (newlyPending.isEmpty() && timerJob != null) return

            val anchorRequests = if (newlyPending.isNotEmpty()) newlyPending else nextById
            val latestCreatedAt = anchorRequests.values.filterNotNull().maxOrNull() ?: snapshotTimeMillis
            val warningAt = latestCreatedAt + PENDING_REQUEST_WARNING_INTERVAL_MS
            scheduleLocked((warningAt - snapshotTimeMillis).coerceAtLeast(0L))
        }
    }

    private fun scheduleLocked(delayMillis: Long) {
        timerJob?.cancel()
        lateinit var scheduledJob: Job
        scheduledJob = scope.launch(start = CoroutineStart.LAZY) {
            delay(delayMillis)
            synchronized(lock) {
                if (timerJob !== scheduledJob || pendingRequests.isEmpty()) return@synchronized
                timerJob = null
                runCatching(onWarning)
                if (pendingRequests.isNotEmpty() && timerJob == null) {
                    scheduleLocked(PENDING_REQUEST_WARNING_INTERVAL_MS)
                }
            }
        }
        timerJob = scheduledJob
        scheduledJob.start()
    }

    private fun parsePendingRequests(snapshotJson: String): PendingSnapshot? = runCatching {
        val snapshot = JSONObject(snapshotJson)
        val requests = snapshot.optJSONArray("activeRequests") ?: return null
        val serverTimeMillis = (snapshot.opt("serverTime") as? String)
            ?.let { value -> runCatching { Instant.parse(value).toEpochMilli() }.getOrNull() }
        val pending = buildList {
            for (index in 0 until requests.length()) {
                val request = requests.optJSONObject(index) ?: continue
                if (request.optString("status") != "PENDING") continue
                val id = request.opt("id") as? String ?: continue
                if (id.isBlank()) continue
                val createdAtMillis = (request.opt("createdAt") as? String)
                    ?.let { value -> runCatching { Instant.parse(value).toEpochMilli() }.getOrNull() }
                add(PendingRequest(id, createdAtMillis))
            }
        }
        PendingSnapshot(pending, serverTimeMillis)
    }.getOrNull()
}
