package com.hotelalert.notificationreceiver.receiver

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.hotelalert.notificationreceiver.HotelAlertApplication
import com.hotelalert.notificationreceiver.MainActivity
import com.hotelalert.notificationreceiver.R
import com.hotelalert.notificationreceiver.protocol.ReceiverServiceController
import com.hotelalert.notificationreceiver.protocol.ReceiverState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class HotelNotificationReceiverService : Service() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var receiver: AndroidLanReceiver? = null

    override fun onCreate() {
        super.onCreate()
        createServiceChannel()
        startInForeground()
        receiver = (application as HotelAlertApplication).component.createReceiver(serviceScope)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            (application as HotelAlertApplication).component.configurationStore.writeReceiverRunIntent(false)
            stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_RESTART) {
            receiver?.stop()
            receiver = (application as HotelAlertApplication).component.createReceiver(serviceScope)
            startReceiverIfEnabled(startId)
            return START_STICKY
        }
        if (intent?.action == ACTION_START || intent == null) {
            startReceiverIfEnabled(startId)
            return START_STICKY
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        receiver?.stop()
        serviceScope.cancel()
        (application as? HotelAlertApplication)?.component?.statusStore?.update(ReceiverState.STOPPED)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startInForeground() {
        val notification = NotificationCompat.Builder(this, SERVICE_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(getString(R.string.receiver_service_notification))
            .setContentIntent(openDiagnosticsIntent())
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun openDiagnosticsIntent(): PendingIntent = PendingIntent.getActivity(
        this,
        NOTIFICATION_ID,
        Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(MainActivity.EXTRA_SHOW_DIAGNOSTICS, true),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    private fun createServiceChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(
                SERVICE_CHANNEL_ID,
                getString(R.string.receiver_service_notification),
                NotificationManager.IMPORTANCE_LOW
            )
        )
    }

    private fun startReceiverIfEnabled(startId: Int) {
        serviceScope.launch {
            val component = (application as HotelAlertApplication).component
            if (component.shouldStartReceiver()) {
                receiver?.start()
            } else {
                receiver?.stop()
                stopSelfResult(startId)
            }
        }
    }

    companion object {
        private const val SERVICE_CHANNEL_ID = "hotel-alert-receiver-service"
        private const val NOTIFICATION_ID = 10_001
        private const val ACTION_START = "com.hotelalert.notificationreceiver.START"
        private const val ACTION_RESTART = "com.hotelalert.notificationreceiver.RESTART"
        private const val ACTION_STOP = "com.hotelalert.notificationreceiver.STOP"

        fun start(context: Context) {
            persistRunIntent(context, true)
            val intent = Intent(context, HotelNotificationReceiverService::class.java).setAction(ACTION_START)
            ContextCompat.startForegroundService(context, intent)
        }

        fun restart(context: Context) {
            persistRunIntent(context, true)
            val intent = Intent(context, HotelNotificationReceiverService::class.java).setAction(ACTION_RESTART)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            try {
                persistRunIntent(context, false)
            } finally {
                context.startService(Intent(context, HotelNotificationReceiverService::class.java).setAction(ACTION_STOP))
            }
        }

        private fun persistRunIntent(context: Context, enabled: Boolean) {
            val application = context.applicationContext as? HotelAlertApplication ?: return
            application.component.configurationStore.writeReceiverRunIntent(enabled)
        }
    }
}

class AndroidReceiverServiceController(private val context: Context) : ReceiverServiceController {
    override fun restart() {
        HotelNotificationReceiverService.restart(context)
    }
}
