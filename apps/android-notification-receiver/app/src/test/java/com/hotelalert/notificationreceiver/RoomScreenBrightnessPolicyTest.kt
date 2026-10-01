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
}
