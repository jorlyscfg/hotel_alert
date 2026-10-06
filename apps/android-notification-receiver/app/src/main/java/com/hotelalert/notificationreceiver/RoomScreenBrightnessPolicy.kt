package com.hotelalert.notificationreceiver

internal const val DEFAULT_ROOM_SCREEN_BRIGHTNESS_PERCENT = 80
internal const val MIN_ROOM_SCREEN_BRIGHTNESS_PERCENT = 1
internal const val MAX_ROOM_SCREEN_BRIGHTNESS_PERCENT = 100
internal const val ROOM_SCREENSAVER_BRIGHTNESS_STEP_PERCENT = 5
internal const val ROOM_SCREENSAVER_BRIGHTNESS_FLOOR_PERCENT = 5
internal const val ROOM_SCREENSAVER_BRIGHTNESS_STEP_DELAY_MILLIS = 30_000L
internal const val ROOM_WINDOW_BRIGHTNESS_AUTOMATIC = -1f
internal const val ROOM_SCREENSAVER_LEFT_KEY_CODE = 135 // KEYCODE_F5
internal const val ROOM_SCREENSAVER_RIGHT_KEY_CODE = 136 // KEYCODE_F6
internal const val ROOM_SCREENSAVER_KEY_ACTION_DOWN = 0

internal enum class RoomScreensaverButtonAction {
    TOGGLE_DO_NOT_DISTURB,
    TOGGLE_DISPLAY_BLACKOUT
}

internal data class RoomScreenBrightnessPreference(
    val manualEnabled: Boolean = false,
    val levelPercent: Int = DEFAULT_ROOM_SCREEN_BRIGHTNESS_PERCENT
)

internal data class RoomScreensaverBrightnessReadiness(
    val activityResumed: Boolean,
    val windowFocused: Boolean,
    val diagnosticsMode: Boolean,
    val maintenanceActive: Boolean,
    val hasServerOrigin: Boolean
)

internal fun shouldApplyRoomScreensaverBrightness(
    requestedByWebView: Boolean,
    readiness: RoomScreensaverBrightnessReadiness
): Boolean = requestedByWebView && readiness.activityResumed && readiness.windowFocused &&
    !readiness.diagnosticsMode && !readiness.maintenanceActive && readiness.hasServerOrigin

internal fun normalizeRoomScreenBrightnessPercent(levelPercent: Int): Int =
    levelPercent.coerceIn(MIN_ROOM_SCREEN_BRIGHTNESS_PERCENT, MAX_ROOM_SCREEN_BRIGHTNESS_PERCENT)

internal fun normalizedRoomScreenBrightnessPreference(
    manualEnabled: Boolean,
    levelPercent: Int
): RoomScreenBrightnessPreference = RoomScreenBrightnessPreference(
    manualEnabled = manualEnabled,
    levelPercent = normalizeRoomScreenBrightnessPercent(levelPercent)
)

internal fun roomScreensaverBrightnessStartPercent(configuredPercent: Int): Int =
    normalizeRoomScreenBrightnessPercent(configuredPercent)
        .coerceAtLeast(ROOM_SCREENSAVER_BRIGHTNESS_FLOOR_PERCENT)

internal fun roomScreensaverBrightnessPercentAfterStep(currentPercent: Int): Int =
    (currentPercent - ROOM_SCREENSAVER_BRIGHTNESS_STEP_PERCENT)
        .coerceAtLeast(ROOM_SCREENSAVER_BRIGHTNESS_FLOOR_PERCENT)

internal fun isRoomScreensaverButtonKey(keyCode: Int): Boolean =
    keyCode == ROOM_SCREENSAVER_LEFT_KEY_CODE || keyCode == ROOM_SCREENSAVER_RIGHT_KEY_CODE

internal fun shouldInterceptRoomScreensaverButtonBeforeWebView(
    keyCode: Int,
    isScreensaverEligible: Boolean
): Boolean = isScreensaverEligible && isRoomScreensaverButtonKey(keyCode)

internal fun roomScreensaverButtonAction(
    keyCode: Int,
    eventAction: Int,
    repeatCount: Int,
    isScreensaverActive: Boolean
): RoomScreensaverButtonAction? {
    if (!isScreensaverActive || eventAction != ROOM_SCREENSAVER_KEY_ACTION_DOWN || repeatCount != 0) return null
    return when (keyCode) {
        ROOM_SCREENSAVER_LEFT_KEY_CODE -> RoomScreensaverButtonAction.TOGGLE_DO_NOT_DISTURB
        ROOM_SCREENSAVER_RIGHT_KEY_CODE -> RoomScreensaverButtonAction.TOGGLE_DISPLAY_BLACKOUT
        else -> null
    }
}

internal fun roomWindowBrightnessOverride(
    preference: RoomScreenBrightnessPreference,
    isForeground: Boolean,
    isRoomScreensaverActive: Boolean = false,
    screensaverBrightnessPercent: Int = DEFAULT_ROOM_SCREEN_BRIGHTNESS_PERCENT,
    isRoomScreensaverDisplayBlack: Boolean = false
): Float {
    if (!isForeground) return ROOM_WINDOW_BRIGHTNESS_AUTOMATIC
    if (isRoomScreensaverActive) {
        if (isRoomScreensaverDisplayBlack) return 0f
        return screensaverBrightnessPercent
            .coerceIn(ROOM_SCREENSAVER_BRIGHTNESS_FLOOR_PERCENT, MAX_ROOM_SCREEN_BRIGHTNESS_PERCENT) / 100f
    }
    return if (preference.manualEnabled) {
        normalizeRoomScreenBrightnessPercent(preference.levelPercent) / 100f
    } else {
        ROOM_WINDOW_BRIGHTNESS_AUTOMATIC
    }
}
