package com.hotelalert.notificationreceiver.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.hotelalert.notificationreceiver.HotelAlertApplication
import com.hotelalert.notificationreceiver.MainActivity
import com.hotelalert.notificationreceiver.R
import com.hotelalert.notificationreceiver.notification.NotificationMapper
import com.hotelalert.notificationreceiver.protocol.NativeRequestCommandResult
import com.hotelalert.notificationreceiver.protocol.NativeRequestTargetStatus
import com.hotelalert.notificationreceiver.protocol.NativeRequestTransition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

private const val ACTION_START_REQUEST = "com.hotelalert.notificationreceiver.START_REQUEST"
private const val EXTRA_REQUEST_ID = "requestId"
private const val EXTRA_EXPECTED_VERSION = "expectedVersion"
private const val EXTRA_IDEMPOTENCY_KEY = "idempotencyKey"
private const val EXTRA_NOTIFICATION_ID = "notificationId"
private const val FAILURE_NOTIFICATION_ID = 20_001

/** Handles request actions without requiring the WebView or Activity to be running. */
class NotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pendingResult = goAsync()
        val application = context.applicationContext as? HotelAlertApplication
        val request = ActionRequest.fromIntent(intent)
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                val result = if (application == null || request == null) {
                    NativeRequestCommandResult.Failure("INVALID_REQUEST_COMMAND")
                } else {
                    application.component.transitionRequest(request.toTransition())
                }
                when (result) {
                    is NativeRequestCommandResult.Success -> cancelSourceNotification(context, request)
                    is NativeRequestCommandResult.Failure -> showFailureNotification(
                        context,
                        request?.sourceNotificationId,
                        result.errorCode
                    )
                }
            } finally {
                pendingResult.finish()
            }
        }
    }

    private fun cancelSourceNotification(context: Context, request: ActionRequest?) {
        val sourceNotificationId = request?.sourceNotificationId
        if (sourceNotificationId == null || sourceNotificationId <= 0) return
        NotificationManagerCompat.from(context).cancel(sourceNotificationId)
        ShortcutManagerCompat.removeDynamicShortcuts(
            context,
            listOf(NotificationMapper.bubbleShortcutIdForRequest(request.requestId))
        )
    }

    private fun showFailureNotification(context: Context, sourceNotificationId: Int?, errorCode: String) {
        val notificationId = NotificationMapper.failureNotificationId(sourceNotificationId ?: FAILURE_NOTIFICATION_ID)
        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(MainActivity.EXTRA_SHOW_DIAGNOSTICS, true)
        }
        val openPendingIntent = android.app.PendingIntent.getActivity(
            context,
            notificationId,
            openIntent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
        )
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return
        }
        manager.notify(
            notificationId,
            NotificationCompat.Builder(context, NotificationMapper.REQUEST_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle(context.getString(R.string.receiver_action_failed_title))
                .setContentText(actionFailureMessage(context, errorCode))
                .setStyle(NotificationCompat.BigTextStyle().bigText(actionFailureMessage(context, errorCode)))
                .setContentIntent(openPendingIntent)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ERROR)
                .build()
        )
    }

    private fun actionFailureMessage(context: Context, errorCode: String): String = when (errorCode) {
        "REQUEST_VERSION_CONFLICT" -> context.getString(R.string.receiver_action_failed_version_conflict)
        "REQUEST_INVALID_TRANSITION" -> context.getString(R.string.receiver_action_failed_invalid_transition)
        "DEVICE_INACTIVE", "DEVICE_TOKEN_REVOKED" -> context.getString(R.string.receiver_action_failed_device)
        "NATIVE_DEVICE_COMMANDS_UNAVAILABLE" -> context.getString(R.string.receiver_action_failed_unavailable)
        else -> context.getString(R.string.receiver_action_failed_generic)
    }

    data class ActionRequest(
        val requestId: String,
        val expectedVersion: Int,
        val idempotencyKey: String,
        val sourceNotificationId: Int?
    ) {
        fun toTransition(): NativeRequestTransition = NativeRequestTransition(
            requestId = requestId,
            targetStatus = NativeRequestTargetStatus.IN_PROGRESS,
            expectedVersion = expectedVersion,
            idempotencyKey = idempotencyKey
        )

        companion object {
            fun fromIntent(intent: Intent): ActionRequest? {
                val requestId = intent.getStringExtra(EXTRA_REQUEST_ID)?.trim().orEmpty()
                val idempotencyKey = intent.getStringExtra(EXTRA_IDEMPOTENCY_KEY)?.trim().orEmpty()
                val expectedVersion = intent.getIntExtra(EXTRA_EXPECTED_VERSION, -1)
                if (requestId.isEmpty() || idempotencyKey.isEmpty() || expectedVersion <= 0) return null
                return ActionRequest(
                    requestId = requestId,
                    expectedVersion = expectedVersion,
                    idempotencyKey = idempotencyKey,
                    sourceNotificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, -1).takeIf { it > 0 }
                )
            }
        }
    }

    companion object {
        fun startRequestIntent(context: Context, content: com.hotelalert.notificationreceiver.notification.NotificationContent): Intent =
            Intent(context, NotificationActionReceiver::class.java).apply {
                action = ACTION_START_REQUEST
                putExtra(EXTRA_REQUEST_ID, content.metadata[EXTRA_REQUEST_ID])
                putExtra(EXTRA_EXPECTED_VERSION, content.metadata[EXTRA_EXPECTED_VERSION]?.toIntOrNull() ?: -1)
                putExtra(EXTRA_IDEMPOTENCY_KEY, content.metadata[EXTRA_IDEMPOTENCY_KEY])
                putExtra(EXTRA_NOTIFICATION_ID, content.notificationId)
            }
    }
}
