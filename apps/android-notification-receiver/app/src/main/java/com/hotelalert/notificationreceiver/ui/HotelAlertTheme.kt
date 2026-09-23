package com.hotelalert.notificationreceiver.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.Canvas
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * Shared visual language for the native recovery surfaces and the web console.
 * Keep these values aligned with apps/web/src/styles.css.
 */
internal object HotelAlertBrand {
    val Ink = Color(0xFF1D2A27)
    val InkSoft = Color(0xFF50605A)
    val Muted = Color(0xFF7B8780)
    val Background = Color(0xFFE9E5DB)
    val Paper = Color(0xFFF7F4EB)
    val PaperDeep = Color(0xFFEEE9DD)
    val Coral = Color(0xFFD76D54)
    val Amber = Color(0xFFECAE45)
    val AmberDeep = Color(0xFFC98228)
    val Sage = Color(0xFF759581)
    val Line = Color(0x242D2A27)
    val ErrorContainer = Color(0xFFFCEAE5)

    val Colors = lightColorScheme(
        primary = Coral,
        onPrimary = Paper,
        primaryContainer = ErrorContainer,
        onPrimaryContainer = Ink,
        secondary = Amber,
        onSecondary = Ink,
        secondaryContainer = Color(0xFFFFEFCB),
        onSecondaryContainer = Ink,
        tertiary = Sage,
        onTertiary = Paper,
        tertiaryContainer = Color(0xFFDDE9DF),
        onTertiaryContainer = Ink,
        background = Background,
        onBackground = Ink,
        surface = Paper,
        onSurface = Ink,
        surfaceVariant = PaperDeep,
        onSurfaceVariant = InkSoft,
        outline = Line,
        outlineVariant = Line,
        error = Coral,
        onError = Paper,
        errorContainer = ErrorContainer,
        onErrorContainer = Ink
    )

    val Typography = Typography(
        displayLarge = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Normal),
        displayMedium = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Normal),
        displaySmall = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Normal),
        headlineLarge = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Normal),
        headlineMedium = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Normal),
        headlineSmall = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Normal),
        titleLarge = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Normal),
        titleMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold),
        titleSmall = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold),
        bodyLarge = TextStyle(fontFamily = FontFamily.SansSerif),
        bodyMedium = TextStyle(fontFamily = FontFamily.SansSerif),
        bodySmall = TextStyle(fontFamily = FontFamily.SansSerif),
        labelLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold),
        labelMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold),
        labelSmall = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold)
    )

    val Shapes = Shapes(
        small = androidx.compose.foundation.shape.RoundedCornerShape(7.dp),
        medium = androidx.compose.foundation.shape.RoundedCornerShape(14.dp),
        large = androidx.compose.foundation.shape.RoundedCornerShape(18.dp)
    )
}

@Composable
internal fun HotelAlertTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = HotelAlertBrand.Colors,
        typography = HotelAlertBrand.Typography,
        shapes = HotelAlertBrand.Shapes,
        content = content
    )
}

@Composable
internal fun HotelAlertBrandMark(modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val stroke = size.minDimension * 0.09f
        val centerX = size.width / 2f
        drawRoundRect(
            color = HotelAlertBrand.Ink,
            topLeft = Offset(size.width * 0.08f, size.height * 0.08f),
            size = androidx.compose.ui.geometry.Size(size.width * 0.84f, size.height * 0.84f),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(size.minDimension * 0.16f)
        )
        drawRoundRect(
            color = HotelAlertBrand.Paper,
            topLeft = Offset(size.width * 0.29f, size.height * 0.2f),
            size = androidx.compose.ui.geometry.Size(size.width * 0.42f, size.height * 0.6f),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(size.minDimension * 0.04f)
        )
        drawLine(
            color = HotelAlertBrand.Amber,
            start = Offset(centerX, size.height * 0.3f),
            end = Offset(centerX, size.height * 0.69f),
            strokeWidth = stroke,
            cap = StrokeCap.Round
        )
        drawCircle(
            color = HotelAlertBrand.Coral,
            radius = size.minDimension * 0.09f,
            center = Offset(size.width * 0.72f, size.height * 0.27f)
        )
    }
}
