package com.hotelalert.notificationreceiver.notification

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.hotelalert.notificationreceiver.R

/**
 * A bounded second chance for devices that show a heads-up notification but do
 * not route the channel sound to the notification stream reliably. This is not
 * a background loop: one short playback is scheduled per alert and a second
 * alert while it is active is coalesced.
 */
internal object AudibleAlertFallback {
    private const val TAG = "HotelAlertSound"
    private const val START_DELAY_MS = 450L
    private const val MAX_PLAYBACK_MS = 2_000L

    private val lock = Any()
    private val handler = Handler(Looper.getMainLooper())
    private var activePlayer: MediaPlayer? = null
    private var pendingStart = false

    fun schedule(context: Context) {
        val appContext = context.applicationContext
        synchronized(lock) {
            if (pendingStart || activePlayer != null) {
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
            if (activePlayer != null) {
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
            releasePlayer(player)
            return
        }
        try {
            player.setOnCompletionListener { releasePlayer(it) }
            player.setOnErrorListener { errorPlayer, what, extra ->
                Log.w(TAG, "fallback=failed reason=player_error what=$what extra=$extra")
                releasePlayer(errorPlayer)
                true
            }
            synchronized(lock) {
                activePlayer = player
            }
            player.start()
            val routedDevice = try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) player.routedDevice else null
            } catch (error: Throwable) {
                Log.w(TAG, "fallback=failed reason=routed_device_query_failed exception=${error.javaClass.simpleName}")
                releasePlayer(player)
                return
            }
            if (!verifyBuiltInSpeakerRoute(
                    routedDevice?.let { AlertAudioOutputDevice(id = it.id, type = it.type) },
                    log = { message ->
                        if (message.startsWith("fallback=route_verified")) Log.i(TAG, message)
                        else Log.w(TAG, message)
                    }
                )
            ) {
                releasePlayer(player)
                return
            }
            Log.i(TAG, "fallback=started route=built_in_speaker")
        } catch (error: Throwable) {
            Log.w(TAG, "fallback=failed reason=player_start_failed exception=${error.javaClass.simpleName}")
            releasePlayer(player)
            return
        }
        // A malformed/unsupported audio resource must never leave a player
        // alive indefinitely, even if completion is not delivered by a vendor.
        handler.postDelayed({ releasePlayer(player) }, MAX_PLAYBACK_MS)
    }

    private fun releasePlayer(player: MediaPlayer) {
        synchronized(lock) {
            if (activePlayer !== player && activePlayer != null) return
            if (activePlayer === player) activePlayer = null
        }
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
    log: (String) -> Unit
): Boolean {
    if (actualDevice?.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
        log("fallback=route_verified actual_device=built_in_speaker")
        return true
    }
    val actualDeviceName = when (actualDevice?.type) {
        null -> "unknown"
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "bluetooth_a2dp"
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth_sco"
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "built_in_earpiece"
        AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "wired_headset"
        else -> "type_${actualDevice.type}"
    }
    log("fallback=failed reason=route_not_built_in_speaker actual_device=$actualDeviceName")
    return false
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
    CHANNEL_SOUND_DISABLED("channel_sound_disabled"),
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
        if (!state.channelHasSound) return AudibleAlertBlockReason.CHANNEL_SOUND_DISABLED
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
