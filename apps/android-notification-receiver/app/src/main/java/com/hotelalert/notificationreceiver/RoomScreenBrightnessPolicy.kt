package com.hotelalert.notificationreceiver

internal const val DEFAULT_ROOM_SCREEN_BRIGHTNESS_PERCENT = 80
internal const val MIN_ROOM_SCREEN_BRIGHTNESS_PERCENT = 1
internal const val MAX_ROOM_SCREEN_BRIGHTNESS_PERCENT = 100
internal const val ROOM_WINDOW_BRIGHTNESS_AUTOMATIC = -1f

internal data class RoomScreenBrightnessPreference(
    val manualEnabled: Boolean = false,
    val levelPercent: Int = DEFAULT_ROOM_SCREEN_BRIGHTNESS_PERCENT
)

internal fun normalizeRoomScreenBrightnessPercent(levelPercent: Int): Int =
    levelPercent.coerceIn(MIN_ROOM_SCREEN_BRIGHTNESS_PERCENT, MAX_ROOM_SCREEN_BRIGHTNESS_PERCENT)

internal fun normalizedRoomScreenBrightnessPreference(
    manualEnabled: Boolean,
    levelPercent: Int
): RoomScreenBrightnessPreference = RoomScreenBrightnessPreference(
    manualEnabled = manualEnabled,
    levelPercent = normalizeRoomScreenBrightnessPercent(levelPercent)
)

internal fun roomWindowBrightnessOverride(
    preference: RoomScreenBrightnessPreference,
    isForeground: Boolean
): Float = if (isForeground && preference.manualEnabled) {
    normalizeRoomScreenBrightnessPercent(preference.levelPercent) / 100f
} else {
    ROOM_WINDOW_BRIGHTNESS_AUTOMATIC
}
