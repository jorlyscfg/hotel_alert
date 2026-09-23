package com.hotelalert.notificationreceiver

import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.graphics.toArgb
import com.hotelalert.notificationreceiver.ui.HotelAlertBrand
import org.junit.Assert.assertEquals
import org.junit.Test

class HotelAlertThemeTest {
    @Test
    fun `brand palette mirrors the web console tokens`() {
        assertEquals(0xFF1D2A27.toInt(), HotelAlertBrand.Ink.toArgb())
        assertEquals(0xFFE9E5DB.toInt(), HotelAlertBrand.Background.toArgb())
        assertEquals(0xFFF7F4EB.toInt(), HotelAlertBrand.Paper.toArgb())
        assertEquals(0xFFD76D54.toInt(), HotelAlertBrand.Coral.toArgb())
        assertEquals(0xFFECAE45.toInt(), HotelAlertBrand.Amber.toArgb())
        assertEquals(0xFF759581.toInt(), HotelAlertBrand.Sage.toArgb())
    }

    @Test
    fun `headings use serif and body copy uses sans serif`() {
        assertEquals(FontFamily.Serif, HotelAlertBrand.Typography.headlineSmall.fontFamily)
        assertEquals(FontFamily.SansSerif, HotelAlertBrand.Typography.bodyMedium.fontFamily)
    }
}
