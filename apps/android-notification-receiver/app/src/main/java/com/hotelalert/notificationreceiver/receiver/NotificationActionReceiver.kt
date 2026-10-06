package com.hotelalert.notificationreceiver.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.hotelalert.notificationreceiver.MainActivity
import com.hotelalert.notificationreceiver.protocol.notificationStartRequestId

private const val EXTRA_REQUEST_ID = "requestId"

/** Routes legacy request actions to the WebView responsible form instead of transitioning directly. */
class NotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val requestId = notificationStartRequestId(intent.getStringExtra(EXTRA_REQUEST_ID)) ?: return
        context.startActivity(MainActivity.startRequestIntent(context, requestId))
    }
}
