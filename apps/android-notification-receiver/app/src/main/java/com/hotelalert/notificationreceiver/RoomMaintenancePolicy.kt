package com.hotelalert.notificationreceiver

/** Counts a short sequence of taps without depending on their screen coordinates. */
internal class RoomMaintenanceTapGate(
    private val requiredTaps: Int = REQUIRED_TAPS,
    private val maximumGapMillis: Long = MAXIMUM_GAP_MILLIS
) {
    private var tapCount = 0
    private var lastTapAtMillis: Long? = null

    fun onTap(hasRoomSession: Boolean, maintenanceOpen: Boolean, nowMillis: Long): Boolean {
        if (!hasRoomSession || maintenanceOpen) {
            reset()
            return false
        }

        val previousTap = lastTapAtMillis
        if (previousTap == null || nowMillis < previousTap || nowMillis - previousTap > maximumGapMillis) {
            tapCount = 0
        }
        lastTapAtMillis = nowMillis
        tapCount += 1

        if (tapCount < requiredTaps) return false
        reset()
        return true
    }

    private fun reset() {
        tapCount = 0
        lastTapAtMillis = null
    }

    companion object {
        const val REQUIRED_TAPS = 4
        const val MAXIMUM_GAP_MILLIS = 500L
    }
}
