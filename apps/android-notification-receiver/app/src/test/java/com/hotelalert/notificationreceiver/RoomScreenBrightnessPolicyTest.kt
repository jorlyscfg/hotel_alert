package com.hotelalert.notificationreceiver

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RoomScreenBrightnessPolicyTest {
    @Test
    fun `unset preference preserves Android automatic brightness`() {
        val preference = RoomScreenBrightnessPreference()

        assertFalse(preference.manualEnabled)
        assertEquals(DEFAULT_ROOM_SCREEN_BRIGHTNESS_PERCENT, preference.levelPercent)
        assertEquals(
            ROOM_WINDOW_BRIGHTNESS_AUTOMATIC,
            roomWindowBrightnessOverride(preference, isForeground = true),
            0f
        )
    }

    @Test
    fun `manual brightness is bounded above zero and only applies while foreground`() {
        val minimum = normalizedRoomScreenBrightnessPreference(manualEnabled = true, levelPercent = 0)
        val maximum = normalizedRoomScreenBrightnessPreference(manualEnabled = true, levelPercent = 101)

        assertEquals(MIN_ROOM_SCREEN_BRIGHTNESS_PERCENT, minimum.levelPercent)
        assertEquals(0.01f, roomWindowBrightnessOverride(minimum, isForeground = true), 0f)
        assertEquals(MAX_ROOM_SCREEN_BRIGHTNESS_PERCENT, maximum.levelPercent)
        assertEquals(1f, roomWindowBrightnessOverride(maximum, isForeground = true), 0f)
        assertEquals(
            ROOM_WINDOW_BRIGHTNESS_AUTOMATIC,
            roomWindowBrightnessOverride(maximum, isForeground = false),
            0f
        )
    }

    @Test
    fun `automatic mode ignores a stored manual level`() {
        val preference = normalizedRoomScreenBrightnessPreference(manualEnabled = false, levelPercent = 55)

        assertTrue(preference.levelPercent in MIN_ROOM_SCREEN_BRIGHTNESS_PERCENT..MAX_ROOM_SCREEN_BRIGHTNESS_PERCENT)
        assertEquals(
            ROOM_WINDOW_BRIGHTNESS_AUTOMATIC,
            roomWindowBrightnessOverride(preference, isForeground = true),
            0f
        )
    }

    @Test
    fun `screensaver brightness overrides manual setting only while foreground saver is active`() {
        val preference = normalizedRoomScreenBrightnessPreference(manualEnabled = true, levelPercent = 65)

        assertEquals(
            0.65f,
            roomWindowBrightnessOverride(
                preference,
                isForeground = true,
                isRoomScreensaverActive = true,
                screensaverBrightnessPercent = roomScreensaverBrightnessStartPercent(preference.levelPercent)
            ),
            0f
        )
        assertEquals(
            0.65f,
            roomWindowBrightnessOverride(preference, isForeground = true, isRoomScreensaverActive = false),
            0f
        )
        assertEquals(
            ROOM_WINDOW_BRIGHTNESS_AUTOMATIC,
            roomWindowBrightnessOverride(preference, isForeground = false, isRoomScreensaverActive = true),
            0f
        )
    }

    @Test
    fun `screensaver exit restores automatic brightness mode`() {
        val preference = normalizedRoomScreenBrightnessPreference(manualEnabled = false, levelPercent = 65)

        assertEquals(
            0.65f,
            roomWindowBrightnessOverride(
                preference,
                isForeground = true,
                isRoomScreensaverActive = true,
                screensaverBrightnessPercent = roomScreensaverBrightnessStartPercent(preference.levelPercent)
            ),
            0f
        )
        assertEquals(
            ROOM_WINDOW_BRIGHTNESS_AUTOMATIC,
            roomWindowBrightnessOverride(preference, isForeground = true, isRoomScreensaverActive = false),
            0f
        )
    }

    @Test
    fun `screensaver starts at the maintenance level and steps down to the floor`() {
        assertEquals(5, ROOM_SCREENSAVER_BRIGHTNESS_STEP_PERCENT)
        assertEquals(5, ROOM_SCREENSAVER_BRIGHTNESS_FLOOR_PERCENT)
        assertEquals(80, roomScreensaverBrightnessStartPercent(80))
        assertEquals(65, roomScreensaverBrightnessStartPercent(65))
        assertEquals(5, roomScreensaverBrightnessStartPercent(5))
        assertEquals(75, roomScreensaverBrightnessPercentAfterStep(80))
        assertEquals(70, roomScreensaverBrightnessPercentAfterStep(75))
        assertEquals(15, roomScreensaverBrightnessPercentAfterStep(20))
        assertEquals(10, roomScreensaverBrightnessPercentAfterStep(15))
        assertEquals(5, roomScreensaverBrightnessPercentAfterStep(10))
        assertEquals(5, roomScreensaverBrightnessPercentAfterStep(5))
    }

    @Test
    fun `lowered saver brightness is bounded and configured brightness is restored on exit`() {
        val preference = normalizedRoomScreenBrightnessPreference(manualEnabled = true, levelPercent = 65)

        assertEquals(
            0.05f,
            roomWindowBrightnessOverride(
                preference,
                isForeground = true,
                isRoomScreensaverActive = true,
                screensaverBrightnessPercent = ROOM_SCREENSAVER_BRIGHTNESS_FLOOR_PERCENT
            ),
            0f
        )
        assertEquals(
            0.05f,
            roomWindowBrightnessOverride(
                preference,
                isForeground = true,
                isRoomScreensaverActive = true,
                screensaverBrightnessPercent = 0
            ),
            0f
        )
        assertEquals(
            0.65f,
            roomWindowBrightnessOverride(
                preference,
                isForeground = true,
                isRoomScreensaverActive = false,
                screensaverBrightnessPercent = ROOM_SCREENSAVER_BRIGHTNESS_FLOOR_PERCENT
            ),
            0f
        )
        assertEquals(
            ROOM_WINDOW_BRIGHTNESS_AUTOMATIC,
            roomWindowBrightnessOverride(
                preference,
                isForeground = false,
                isRoomScreensaverActive = false,
                screensaverBrightnessPercent = ROOM_SCREENSAVER_BRIGHTNESS_FLOOR_PERCENT
            ),
            0f
        )
    }

    @Test
    fun `cached ROOM saver dims without native room session restoration`() {
        val preference = normalizedRoomScreenBrightnessPreference(manualEnabled = true, levelPercent = 65)
        val startPercent = roomScreensaverBrightnessStartPercent(preference.levelPercent)
        val isScreensaverActive = shouldApplyRoomScreensaverBrightness(
            requestedByWebView = true,
            readiness = readyScreensaver
        )

        assertTrue(isScreensaverActive)
        assertEquals(
            startPercent / 100f,
            roomWindowBrightnessOverride(
                preference,
                isForeground = true,
                isRoomScreensaverActive = isScreensaverActive,
                screensaverBrightnessPercent = startPercent
            ),
            0f
        )
        assertEquals(
            0.60f,
            roomWindowBrightnessOverride(
                preference,
                isForeground = true,
                isRoomScreensaverActive = isScreensaverActive,
                screensaverBrightnessPercent = roomScreensaverBrightnessPercentAfterStep(startPercent)
            ),
            0f
        )
    }

    @Test
    fun `explicit saver exit clears request and restores manual or automatic brightness`() {
        val manualPreference = normalizedRoomScreenBrightnessPreference(manualEnabled = true, levelPercent = 65)

        assertTrue(shouldApplyRoomScreensaverBrightness(requestedByWebView = true, readiness = readyScreensaver))
        val afterWebViewExit = shouldApplyRoomScreensaverBrightness(requestedByWebView = false, readiness = readyScreensaver)
        assertFalse(afterWebViewExit)
        assertEquals(
            0.65f,
            roomWindowBrightnessOverride(
                manualPreference,
                isForeground = true,
                isRoomScreensaverActive = afterWebViewExit
            ),
            0f
        )

        val automaticPreference = normalizedRoomScreenBrightnessPreference(manualEnabled = false, levelPercent = 65)
        assertEquals(
            ROOM_WINDOW_BRIGHTNESS_AUTOMATIC,
            roomWindowBrightnessOverride(
                automaticPreference,
                isForeground = true,
                isRoomScreensaverActive = afterWebViewExit
            ),
            0f
        )
    }

    @Test
    fun `focus and lifecycle loss pause saver brightness without consuming its request`() {
        val requestedByWebView = true
        val preference = normalizedRoomScreenBrightnessPreference(manualEnabled = true, levelPercent = 65)

        assertTrue(shouldApplyRoomScreensaverBrightness(requestedByWebView, readyScreensaver))
        val pausedReadiness = readyScreensaver.copy(activityResumed = false, windowFocused = false)
        assertFalse(shouldApplyRoomScreensaverBrightness(requestedByWebView, pausedReadiness))
        assertTrue(requestedByWebView)
        assertEquals(
            ROOM_WINDOW_BRIGHTNESS_AUTOMATIC,
            roomWindowBrightnessOverride(
                preference,
                isForeground = false,
                isRoomScreensaverActive = shouldApplyRoomScreensaverBrightness(requestedByWebView, pausedReadiness)
            ),
            0f
        )

        val resumedReadiness = pausedReadiness.copy(activityResumed = true, windowFocused = true)
        assertTrue(shouldApplyRoomScreensaverBrightness(requestedByWebView, resumedReadiness))
        assertEquals(
            0.65f,
            roomWindowBrightnessOverride(
                preference,
                isForeground = true,
                isRoomScreensaverActive = shouldApplyRoomScreensaverBrightness(requestedByWebView, resumedReadiness),
                screensaverBrightnessPercent = roomScreensaverBrightnessStartPercent(preference.levelPercent)
            ),
            0f
        )
    }

    @Test
    fun `blackout sets only the foreground saver window to zero and wake restores current ramp`() {
        val preference = normalizedRoomScreenBrightnessPreference(manualEnabled = true, levelPercent = 80)
        val rampPercent = 55

        assertEquals(
            0f,
            roomWindowBrightnessOverride(
                preference,
                isForeground = true,
                isRoomScreensaverActive = true,
                screensaverBrightnessPercent = rampPercent,
                isRoomScreensaverDisplayBlack = true
            ),
            0f
        )
        assertEquals(
            rampPercent / 100f,
            roomWindowBrightnessOverride(
                preference,
                isForeground = true,
                isRoomScreensaverActive = true,
                screensaverBrightnessPercent = rampPercent
            ),
            0f
        )
        assertEquals(
            0.8f,
            roomWindowBrightnessOverride(
                preference,
                isForeground = true,
                isRoomScreensaverActive = false,
                screensaverBrightnessPercent = rampPercent,
                isRoomScreensaverDisplayBlack = true
            ),
            0f
        )
        val automaticPreference = normalizedRoomScreenBrightnessPreference(manualEnabled = false, levelPercent = 80)
        assertEquals(
            ROOM_WINDOW_BRIGHTNESS_AUTOMATIC,
            roomWindowBrightnessOverride(
                automaticPreference,
                isForeground = true,
                isRoomScreensaverActive = false,
                screensaverBrightnessPercent = rampPercent
            ),
            0f
        )
    }

    @Test
    fun `physical button keys map to DND and blackout only on first down during saver`() {
        assertEquals(
            RoomScreensaverButtonAction.TOGGLE_DO_NOT_DISTURB,
            roomScreensaverButtonAction(ROOM_SCREENSAVER_LEFT_KEY_CODE, ROOM_SCREENSAVER_KEY_ACTION_DOWN, 0, true)
        )
        assertEquals(
            RoomScreensaverButtonAction.TOGGLE_DISPLAY_BLACKOUT,
            roomScreensaverButtonAction(ROOM_SCREENSAVER_RIGHT_KEY_CODE, ROOM_SCREENSAVER_KEY_ACTION_DOWN, 0, true)
        )
        assertEquals(null, roomScreensaverButtonAction(ROOM_SCREENSAVER_LEFT_KEY_CODE, ROOM_SCREENSAVER_KEY_ACTION_DOWN, 1, true))
        assertEquals(null, roomScreensaverButtonAction(ROOM_SCREENSAVER_LEFT_KEY_CODE, 1, 0, true))
        assertEquals(null, roomScreensaverButtonAction(ROOM_SCREENSAVER_LEFT_KEY_CODE, ROOM_SCREENSAVER_KEY_ACTION_DOWN, 0, false))
        assertEquals(null, roomScreensaverButtonAction(999, ROOM_SCREENSAVER_KEY_ACTION_DOWN, 0, true))
    }

    @Test
    fun `eligible saver keys are intercepted before the focused WebView`() {
        assertTrue(shouldInterceptRoomScreensaverButtonBeforeWebView(ROOM_SCREENSAVER_LEFT_KEY_CODE, true))
        assertTrue(shouldInterceptRoomScreensaverButtonBeforeWebView(ROOM_SCREENSAVER_RIGHT_KEY_CODE, true))
        assertFalse(shouldInterceptRoomScreensaverButtonBeforeWebView(ROOM_SCREENSAVER_LEFT_KEY_CODE, false))
        assertFalse(shouldInterceptRoomScreensaverButtonBeforeWebView(999, true))
    }

    @Test
    fun `diagnostics maintenance and missing server origin block saver brightness`() {
        assertFalse(
            shouldApplyRoomScreensaverBrightness(
                requestedByWebView = true,
                readiness = readyScreensaver.copy(diagnosticsMode = true)
            )
        )
        assertFalse(
            shouldApplyRoomScreensaverBrightness(
                requestedByWebView = true,
                readiness = readyScreensaver.copy(maintenanceActive = true)
            )
        )
        assertFalse(
            shouldApplyRoomScreensaverBrightness(
                requestedByWebView = true,
                readiness = readyScreensaver.copy(hasServerOrigin = false)
            )
        )
        assertFalse(
            shouldApplyRoomScreensaverBrightness(
                requestedByWebView = true,
                readiness = readyScreensaver.copy(activityResumed = false)
            )
        )
        assertFalse(
            shouldApplyRoomScreensaverBrightness(
                requestedByWebView = true,
                readiness = readyScreensaver.copy(windowFocused = false)
            )
        )
    }

    private companion object {
        val readyScreensaver = RoomScreensaverBrightnessReadiness(
            activityResumed = true,
            windowFocused = true,
            diagnosticsMode = false,
            maintenanceActive = false,
            hasServerOrigin = true
        )
    }
}
