package com.hotelalert.notificationreceiver.notification

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioRouting
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.hotelalert.notificationreceiver.R

/**
 * Plays one app-owned alert after the actual output route is verified as the
 * tablet speaker. Playback stays muted while Android resolves that route, and
 * overlapping alerts are coalesced.
 */
internal object AudibleAlertFallback {
    private const val TAG = "HotelAlertSound"
    private const val START_DELAY_MS = 450L
    private const val ROUTE_CHECK_INTERVAL_MS = 50L
    private const val ROUTE_CHECK_TIMEOUT_MS = 900L
    private const val MAX_PLAYBACK_MS = 2_000L

    private val lock = Any()
    private val handler = Handler(Looper.getMainLooper())
    private var activePlayback: ActiveAlertPlayback? = null
    private var pendingStart = false

    private class ActiveAlertPlayback(
        val player: MediaPlayer,
        val startedAtMs: Long
    ) {
        var routeListener: AudioRouting.OnRoutingChangedListener? = null
        var pendingRouteLogged = false
        var routeVerified = false
    }

    fun schedule(context: Context) {
        val appContext = context.applicationContext
        synchronized(lock) {
            if (pendingStart || activePlayback != null) {
                logSuppressed(AudibleAlertBlockReason.ALREADY_PLAYING)
                return
            }
            blockReason(appContext)?.let { reason ->
                logSuppressed(reason)
                return
            }
            pendingStart = true
        }
        handler.postDelayed({ play(appContext) }, START_DELAY_MS)
    }

    private fun play(context: Context) {
        val blockReason = synchronized(lock) {
            pendingStart = false
            if (activePlayback != null) {
                AudibleAlertBlockReason.ALREADY_PLAYING
            } else {
                blockReason(context)
            }
        }
        if (blockReason != null) {
            logSuppressed(blockReason)
            return
        }

        val player = createAlertMediaPlayer(
            configuration = AudibleAlertPlayerConfiguration.requestAlert(),
            createPlayer = { configuration ->
                val audioAttributes = AudioAttributes.Builder()
                    .setUsage(configuration.usage)
                    .setContentType(configuration.contentType)
                    .build()
                MediaPlayer.create(
                    context,
                    configuration.resourceId,
                    audioAttributes,
                    configuration.audioSessionId
                )
            },
            logFailure = { reason -> Log.w(TAG, "fallback=failed reason=$reason") }
        ) ?: return
        if (!requestSpeakerRoute(context, player)) {
            disposeUnstartedPlayer(player)
            return
        }
        try {
            player.setVolume(0f, 0f)
            player.isLooping = true
            val playback = ActiveAlertPlayback(player, SystemClock.elapsedRealtime())
            val routeListener = AudioRouting.OnRoutingChangedListener {
                handler.post { verifyPlaybackRoute(playback) }
            }
            playback.routeListener = routeListener
            player.setOnCompletionListener { releasePlayer(playback) }
            player.setOnErrorListener { _, what, extra ->
                Log.w(TAG, "fallback=failed reason=player_error what=$what extra=$extra")
                releasePlayer(playback)
                true
            }
            synchronized(lock) {
                activePlayback = playback
            }
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
                throw UnsupportedOperationException("Speaker route verification requires Android 9 or newer.")
            }
            player.addOnRoutingChangedListener(routeListener, handler)
            player.start()
            // A route change callback is authoritative when available. Polling
            // covers vendors that do not deliver it promptly after start().
            verifyPlaybackRoute(playback)
        } catch (error: Throwable) {
            Log.w(TAG, "fallback=failed reason=player_start_failed exception=${error.javaClass.simpleName}")
            releaseActivePlayer(player)
            return
        }
    }

    private fun verifyPlaybackRoute(playback: ActiveAlertPlayback) {
        val previouslyVerified = synchronized(lock) {
            if (activePlayback !== playback) return
            playback.routeVerified
        }

        val routedDevice = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) playback.player.routedDevice else null
        } catch (error: Throwable) {
            Log.w(TAG, "fallback=failed reason=routed_device_query_failed exception=${error.javaClass.simpleName}")
            releasePlayer(playback)
            return
        }
        val result = verifyBuiltInSpeakerRoute(
            routedDevice?.let { AlertAudioOutputDevice(id = it.id, type = it.type) },
            elapsedMs = SystemClock.elapsedRealtime() - playback.startedAtMs,
            timeoutMs = ROUTE_CHECK_TIMEOUT_MS,
            previouslyVerified = previouslyVerified,
            log = { message ->
                if (message.startsWith("fallback=route_verified")) Log.i(TAG, message)
                else Log.w(TAG, message)
            }
        )
        when (result) {
            SpeakerRouteCheckResult.PENDING -> {
                if (!playback.pendingRouteLogged) {
                    playback.pendingRouteLogged = true
                    Log.i(TAG, "fallback=route_pending actual_device=unknown")
                }
                handler.postDelayed({ verifyPlaybackRoute(playback) }, ROUTE_CHECK_INTERVAL_MS)
            }
            SpeakerRouteCheckResult.REJECTED, SpeakerRouteCheckResult.TIMED_OUT -> releasePlayer(playback)
            SpeakerRouteCheckResult.VERIFIED -> {
                if (previouslyVerified) return
                try {
                    playback.player.isLooping = false
                    playback.player.seekTo(0)
                    playback.player.setVolume(1f, 1f)
                    synchronized(lock) { playback.routeVerified = true }
                    Log.i(TAG, "fallback=started route=built_in_speaker")
                    handler.postDelayed({ releasePlayer(playback) }, MAX_PLAYBACK_MS)
                } catch (error: Throwable) {
                    Log.w(TAG, "fallback=failed reason=unmute_after_route_verification exception=${error.javaClass.simpleName}")
                    releasePlayer(playback)
                }
            }
        }
    }

    private fun releaseActivePlayer(player: MediaPlayer) {
        val playback = synchronized(lock) { activePlayback?.takeIf { it.player === player } }
        if (playback == null) disposeUnstartedPlayer(player) else releasePlayer(playback)
    }

    private fun releasePlayer(playback: ActiveAlertPlayback) {
        synchronized(lock) {
            if (activePlayback !== playback) return
            activePlayback = null
        }
        playback.routeListener?.let { listener ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                runCatching { playback.player.removeOnRoutingChangedListener(listener) }
            }
        }
        runCatching { playback.player.setVolume(0f, 0f) }
        disposeUnstartedPlayer(playback.player)
    }

    private fun disposeUnstartedPlayer(player: MediaPlayer) {
        runCatching { player.stop() }
        runCatching { player.release() }
    }

    private fun blockReason(context: Context): AudibleAlertBlockReason? {
        val audioManager = context.getSystemService(AudioManager::class.java)
        val notificationManager = context.getSystemService(android.app.NotificationManager::class.java)
        val channelRequired = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        val channel = if (channelRequired) {
            notificationManager?.getNotificationChannel(NotificationMapper.REQUEST_CHANNEL_ID)
        } else {
            null
        }
        val dndAllowsAlerts = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            runCatching {
                notificationManager?.currentInterruptionFilter ==
                    android.app.NotificationManager.INTERRUPTION_FILTER_ALL
            }.getOrDefault(false)
        } else {
            true
        }

        return AudibleAlertEligibility.blockReason(
            AudibleAlertEligibilityState(
                audioManagerAvailable = audioManager != null,
                ringerModeNormal = audioManager?.ringerMode == AudioManager.RINGER_MODE_NORMAL,
                notificationVolume = audioManager?.getStreamVolume(AudioManager.STREAM_NOTIFICATION) ?: 0,
                dndAllowsAlerts = dndAllowsAlerts,
                channelRequired = channelRequired,
                channelExists = !channelRequired || channel != null,
                channelImportance = channel?.importance,
                channelHasSound = channel?.sound != null
            )
        )
    }

    private fun requestSpeakerRoute(context: Context, player: MediaPlayer): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            Log.w(TAG, "fallback=speaker_route_preference accepted=false reason=api_unsupported")
            return false
        }
        val audioManager = context.getSystemService(AudioManager::class.java)
        if (audioManager == null) {
            Log.w(TAG, "fallback=speaker_route_preference accepted=false reason=audio_service_unavailable")
            return false
        }
        val outputDevices = try {
            audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList()
        } catch (error: Throwable) {
            Log.w(TAG, "fallback=speaker_route_preference accepted=false reason=device_enumeration_failed exception=${error.javaClass.simpleName}")
            return false
        }
        val routeDevices = outputDevices.map { AlertAudioOutputDevice(id = it.id, type = it.type) }
        return requestBuiltInSpeakerPreference(
            apiLevel = Build.VERSION.SDK_INT,
            outputDevices = routeDevices,
            setPreferredDevice = { target ->
                val outputDevice = outputDevices.firstOrNull { it.id == target.id && it.type == target.type }
                outputDevice != null && player.setPreferredDevice(outputDevice)
            },
            log = { message ->
                if (message.contains("accepted=true")) Log.i(TAG, message)
                else Log.w(TAG, message)
            }
        )
    }

    private fun logSuppressed(reason: AudibleAlertBlockReason) {
        Log.i(TAG, "fallback=suppressed reason=${reason.logToken}")
    }
}

internal data class AlertAudioOutputDevice(val id: Int, val type: Int)

internal fun requestBuiltInSpeakerPreference(
    apiLevel: Int,
    outputDevices: List<AlertAudioOutputDevice>,
    setPreferredDevice: (AlertAudioOutputDevice) -> Boolean,
    log: (String) -> Unit
): Boolean {
    if (apiLevel < Build.VERSION_CODES.P) {
        log("fallback=speaker_route_preference accepted=false reason=api_unsupported")
        return false
    }
    val speaker = outputDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
    if (speaker == null) {
        log("fallback=speaker_route_preference accepted=false reason=built_in_speaker_unavailable")
        return false
    }
    val accepted = try {
        setPreferredDevice(speaker)
    } catch (error: Throwable) {
        log("fallback=speaker_route_preference accepted=false reason=preference_failed exception=${error.javaClass.simpleName}")
        return false
    }
    if (!accepted) {
        log("fallback=speaker_route_preference accepted=false reason=preferred_device_rejected")
        return false
    }
    log("fallback=speaker_route_preference accepted=true device=built_in_speaker")
    return true
}

internal fun verifyBuiltInSpeakerRoute(
    actualDevice: AlertAudioOutputDevice?,
    elapsedMs: Long,
    timeoutMs: Long,
    previouslyVerified: Boolean = false,
    log: (String) -> Unit
): SpeakerRouteCheckResult {
    if (actualDevice?.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
        log("fallback=route_verified actual_device=built_in_speaker")
        return SpeakerRouteCheckResult.VERIFIED
    }
    if (actualDevice == null && !previouslyVerified && elapsedMs < timeoutMs) {
        return SpeakerRouteCheckResult.PENDING
    }

    val actualDeviceName = when (actualDevice?.type) {
        null -> "unknown"
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "bluetooth_a2dp"
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth_sco"
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "built_in_earpiece"
        AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "wired_headset"
        else -> "type_${actualDevice.type}"
    }
    if (actualDevice != null) {
        val reason = if (previouslyVerified) "route_changed_after_verification" else "route_not_built_in_speaker"
        log("fallback=failed reason=$reason actual_device=$actualDeviceName")
        return SpeakerRouteCheckResult.REJECTED
    }
    if (previouslyVerified) {
        log("fallback=failed reason=route_changed_after_verification actual_device=unknown")
        return SpeakerRouteCheckResult.REJECTED
    }
    log("fallback=failed reason=route_verification_timeout actual_device=$actualDeviceName")
    return SpeakerRouteCheckResult.TIMED_OUT
}

internal enum class SpeakerRouteCheckResult {
    PENDING,
    VERIFIED,
    REJECTED,
    TIMED_OUT
}

internal data class AudibleAlertEligibilityState(
    val audioManagerAvailable: Boolean,
    val ringerModeNormal: Boolean,
    val notificationVolume: Int,
    val dndAllowsAlerts: Boolean,
    val channelRequired: Boolean,
    val channelExists: Boolean,
    val channelImportance: Int?,
    val channelHasSound: Boolean
)

internal enum class AudibleAlertBlockReason(val logToken: String) {
    AUDIO_SERVICE_UNAVAILABLE("audio_service_unavailable"),
    RINGER_MODE_NOT_NORMAL("ringer_mode_not_normal"),
    NOTIFICATION_VOLUME_MUTED("notification_volume_muted"),
    DO_NOT_DISTURB_ACTIVE("do_not_disturb_active"),
    CHANNEL_MISSING("channel_missing"),
    CHANNEL_DISABLED("channel_disabled"),
    CHANNEL_IMPORTANCE_TOO_LOW("channel_importance_too_low"),
    CHANNEL_NOT_SILENT("channel_not_silent"),
    ALREADY_PLAYING("already_playing")
}

internal object AudibleAlertEligibility {
    fun blockReason(state: AudibleAlertEligibilityState): AudibleAlertBlockReason? {
        if (!state.audioManagerAvailable) return AudibleAlertBlockReason.AUDIO_SERVICE_UNAVAILABLE
        if (!state.ringerModeNormal) return AudibleAlertBlockReason.RINGER_MODE_NOT_NORMAL
        if (state.notificationVolume <= 0) return AudibleAlertBlockReason.NOTIFICATION_VOLUME_MUTED
        if (!state.dndAllowsAlerts) return AudibleAlertBlockReason.DO_NOT_DISTURB_ACTIVE
        if (!state.channelRequired) return null
        if (!state.channelExists || state.channelImportance == null) {
            return AudibleAlertBlockReason.CHANNEL_MISSING
        }
        if (state.channelImportance == android.app.NotificationManager.IMPORTANCE_NONE) {
            return AudibleAlertBlockReason.CHANNEL_DISABLED
        }
        if (state.channelImportance < android.app.NotificationManager.IMPORTANCE_DEFAULT) {
            return AudibleAlertBlockReason.CHANNEL_IMPORTANCE_TOO_LOW
        }
        if (state.channelHasSound) return AudibleAlertBlockReason.CHANNEL_NOT_SILENT
        return null
    }
}

internal data class AudibleAlertPlayerConfiguration(
    val resourceId: Int,
    val usage: Int,
    val contentType: Int,
    val audioSessionId: Int
) {
    companion object {
        fun requestAlert() = AudibleAlertPlayerConfiguration(
            resourceId = R.raw.hotel_alert_bell,
            usage = AudioAttributes.USAGE_NOTIFICATION,
            contentType = AudioAttributes.CONTENT_TYPE_SONIFICATION,
            audioSessionId = AudioManager.AUDIO_SESSION_ID_GENERATE
        )
    }
}

internal fun createAlertMediaPlayer(
    configuration: AudibleAlertPlayerConfiguration,
    createPlayer: (AudibleAlertPlayerConfiguration) -> MediaPlayer?,
    logFailure: (String) -> Unit
): MediaPlayer? = try {
    createPlayer(configuration).also { player ->
        if (player == null) logFailure("player_create_returned_null")
    }
} catch (error: Throwable) {
    logFailure("player_create_failed exception=${error.javaClass.simpleName}")
    null
}
