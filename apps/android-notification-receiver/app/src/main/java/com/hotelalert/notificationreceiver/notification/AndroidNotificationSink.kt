package com.hotelalert.notificationreceiver.notification

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import com.hotelalert.notificationreceiver.MainActivity
import com.hotelalert.notificationreceiver.R
import com.hotelalert.notificationreceiver.protocol.NotificationSink
import com.hotelalert.notificationreceiver.protocol.RequestNotification
import com.hotelalert.notificationreceiver.receiver.NotificationActionReceiver

class AndroidNotificationSink(
    private val context: Context,
    private val isAppInForeground: () -> Boolean = { MainActivity.isAppInForeground() }
) : NotificationSink {
    init {
        createChannel()
    }

    override suspend fun deliver(notification: RequestNotification) {
        if (!NotificationMapper.shouldPostOperatorAlert(notification, isAppInForeground())) return
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()
            || android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU
            && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            throw NotificationPermissionDeniedException()
        }
        val content = NotificationMapper.map(notification)
        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(MainActivity.EXTRA_EVENT_ID, notification.eventId)
            putExtra(MainActivity.EXTRA_REQUEST_ID, notification.request.id)
            putExtra(MainActivity.EXTRA_AREA_ID, notification.request.responsibleAreaId)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            content.notificationId,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val startActionPendingIntent = if (content.action == NotificationAction.START_REQUEST) {
            PendingIntent.getBroadcast(
                context,
                content.notificationId,
                NotificationActionReceiver.startRequestIntent(context, content),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        } else {
            null
        }
        val builder = NotificationCompat.Builder(context, content.channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(content.title)
            .setContentText(content.text)
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .setBigContentTitle(content.title)
                    .bigText(content.expandedText)
            )
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setGroup(content.groupKey)
            .setOnlyAlertOnce(false)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            // The bundled player below is the only sound path. Explicitly disable
            // builder defaults for pre-channel Android versions as well.
            .setDefaults(0)
            .setSound(null)
        if (content.action == NotificationAction.START_REQUEST) {
            val bubbleShortcutId = NotificationMapper.bubbleShortcutId(content)
            val bubbleIcon = IconCompat.createWithResource(context, R.drawable.ic_hotel_alert_launcher)
            val actionIntent = NotificationActionReceiver.startRequestIntent(context, content)
            val bubbleLines = content.expandedText.lineSequence().toList()
            val bubbleIntent = Intent(context, RequestBubbleActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(RequestBubbleActivity.EXTRA_TITLE, content.title)
                putExtra(RequestBubbleActivity.EXTRA_ROOM, bubbleLines.getOrNull(0).orEmpty())
                putExtra(RequestBubbleActivity.EXTRA_SERVICE, bubbleLines.getOrNull(1).orEmpty())
                putExtra(RequestBubbleActivity.EXTRA_AREA, bubbleLines.getOrNull(2).orEmpty())
                putExtra(RequestBubbleActivity.EXTRA_ACCEPT_ACTION_INTENT, actionIntent)
            }
            val bubblePendingIntent = PendingIntent.getActivity(
                context,
                content.notificationId xor BUBBLE_PENDING_INTENT_SALT,
                bubbleIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            // Android 11+ requires a real long-lived shortcut for a bubble.
            // Publishing can be declined by the launcher/rate limiter; in that
            // case the standard heads-up notification remains fully functional.
            val shortcutPublished = runCatching {
                ShortcutManagerCompat.pushDynamicShortcut(
                    context,
                    ShortcutInfoCompat.Builder(context, bubbleShortcutId)
                        .setShortLabel(content.title.take(MAX_SHORTCUT_LABEL_LENGTH))
                        .setLongLabel(content.expandedText.take(MAX_SHORTCUT_LABEL_LENGTH * 4))
                        .setIcon(bubbleIcon)
                        .setIntent(bubbleIntent)
                        .setLongLived(true)
                        .build()
                )
            }.getOrDefault(false)
            // The shortcut id constructor is API 30+. Older Android versions
            // still receive the regular actionable heads-up notification.
            if (shortcutPublished && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                builder
                    .setShortcutId(bubbleShortcutId)
                    .setBubbleMetadata(buildBubbleMetadata(bubbleShortcutId, bubbleIcon, bubblePendingIntent))
            }
            builder.addAction(
                NotificationCompat.Action.Builder(
                    android.R.drawable.ic_media_play,
                    context.getString(R.string.receiver_accept_start_request),
                    startActionPendingIntent!!
                ).build()
            )
        }
        manager.notify(content.notificationId, builder.build())
        if (NotificationMapper.shouldPlayAudibleFallback(notification, isAppInForeground())) {
            AudibleAlertFallback.schedule(context)
        }
    }

    private fun createChannel() {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        val previousChannel = manager.getNotificationChannel(NotificationMapper.PREVIOUS_REQUEST_CHANNEL_ID)
            ?: manager.getNotificationChannel(NotificationMapper.LEGACY_REQUEST_CHANNEL_ID)
        manager.createNotificationChannel(
            NotificationChannel(
                NotificationMapper.REQUEST_CHANNEL_ID,
                context.getString(R.string.receiver_channel_name),
                requestChannelImportance(previousChannel?.importance)
            ).apply {
                description = context.getString(R.string.receiver_channel_description)
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                    setAllowBubbles(true)
                }
                // Android permanently owns sound routing for an existing channel.
                // Keep this new channel silent; the app-owned player verifies the
                // built-in speaker route before it unmutes the bundled alert.
                setSound(null, null)
            }
        )
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun buildBubbleMetadata(
        shortcutId: String,
        icon: IconCompat,
        intent: PendingIntent
    ): NotificationCompat.BubbleMetadata = NotificationCompat.BubbleMetadata.Builder(shortcutId)
        .setIcon(icon)
        .setIntent(intent)
        .setDesiredHeight(480)
        .setAutoExpandBubble(false)
        .setSuppressNotification(false)
        .build()

    private companion object {
        const val BUBBLE_PENDING_INTENT_SALT = 0x20000000
        const val MAX_SHORTCUT_LABEL_LENGTH = 40
    }
}

class NotificationPermissionDeniedException : IllegalStateException("Android notification permission is not granted.") {
    val errorCode: String = "POST_NOTIFICATIONS_DENIED"
}

internal fun requestChannelImportance(previousImportance: Int?): Int =
    previousImportance ?: NotificationManager.IMPORTANCE_HIGH
