package com.hotelalert.notificationreceiver.notification

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.hotelalert.notificationreceiver.R

/**
 * A bounded second chance for devices that show a heads-up notification but do
 * not route the channel sound to the notification stream reliably. This is not
 * a background loop: one short playback is scheduled per alert and a second
 * alert while it is active is coalesced.
 */
internal object AudibleAlertFallback {
    private const val START_DELAY_MS = 450L
    private const val MAX_PLAYBACK_MS = 2_000L

    private val lock = Any()
    private val handler = Handler(Looper.getMainLooper())
    private var activePlayer: MediaPlayer? = null
    private var pendingStart = false

    fun schedule(context: Context) {
        val appContext = context.applicationContext
        synchronized(lock) {
            if (pendingStart || activePlayer != null || !isAllowed(appContext)) return
            pendingStart = true
        }
        handler.postDelayed({ play(appContext) }, START_DELAY_MS)
    }

    private fun play(context: Context) {
        synchronized(lock) {
            pendingStart = false
            if (activePlayer != null || !isAllowed(context)) return
        }

        val player = MediaPlayer.create(context, R.raw.hotel_alert_bell) ?: return
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                player.setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
            }
            player.setOnCompletionListener { releasePlayer(it) }
            player.setOnErrorListener { errorPlayer, _, _ ->
                releasePlayer(errorPlayer)
                true
            }
            synchronized(lock) {
                activePlayer = player
            }
            player.start()
        } catch (_: Throwable) {
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

    private fun isAllowed(context: Context): Boolean {
        val audioManager = context.getSystemService(AudioManager::class.java) ?: return false
        if (audioManager.ringerMode != AudioManager.RINGER_MODE_NORMAL) return false
        if (audioManager.getStreamVolume(AudioManager.STREAM_NOTIFICATION) <= 0) return false

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = context.getSystemService(android.app.NotificationManager::class.java)
                ?.getNotificationChannel(NotificationMapper.REQUEST_CHANNEL_ID)
                ?: return false
            // A null channel sound is the user's explicit choice to silence this
            // channel; do not bypass it with the fallback.
            if (channel.importance == android.app.NotificationManager.IMPORTANCE_NONE) return false
            if (channel.sound == null) return false
        }
        return true
    }
}
