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
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.hotelalert.notificationreceiver.HotelAlertApplication
import com.hotelalert.notificationreceiver.MainActivity
import com.hotelalert.notificationreceiver.R
import com.hotelalert.notificationreceiver.protocol.RoomPresenceCycle
import com.hotelalert.notificationreceiver.protocol.RoomPresenceState
import com.hotelalert.notificationreceiver.protocol.roomPresenceRetryDelayMs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class RoomPresenceService : Service() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var wakeLock: PowerManager.WakeLock? = null
    private var loopStarted = false

    override fun onCreate() {
        super.onCreate()
        createServiceChannel()
        startInForeground()
        acquireWakeLock()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (!loopStarted) {
            loopStarted = true
            serviceScope.launch { runPresenceLoop(startId) }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        serviceScope.cancel()
        wakeLock?.let { lock -> if (lock.isHeld) lock.release() }
        wakeLock = null
        val statusStore = (application as? HotelAlertApplication)?.component?.roomPresenceStatusStore
        if (statusStore?.state != RoomPresenceState.INVALIDATED) statusStore?.update(RoomPresenceState.STOPPED)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private suspend fun runPresenceLoop(startId: Int) {
        val component = (application as HotelAlertApplication).component
        val coordinator = component.createRoomPresenceCoordinator()
        var retryAttempt = 0
        while (serviceScope.isActive) {
            when (val cycle = coordinator.runOnce()) {
                is RoomPresenceCycle.Online -> {
                    retryAttempt = 0
                    delay(cycle.heartbeatIntervalMs)
                }
                is RoomPresenceCycle.Retry -> {
                    retryAttempt += 1
                    Log.w(TAG, "ROOM presence retry scheduled (${cycle.errorCode}).")
                    delay(roomPresenceRetryDelayMs(retryAttempt))
                }
                RoomPresenceCycle.Invalidated -> {
                    Log.i(TAG, "ROOM assignment was invalidated; local credentials were cleared.")
                    stopSelfResult(startId)
                    return
                }
                RoomPresenceCycle.Unconfigured -> {
                    stopSelfResult(startId)
                    return
                }
            }
        }
    }

    private fun startInForeground() {
        val notification = NotificationCompat.Builder(this, SERVICE_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(getString(R.string.room_presence_service_notification))
            .setContentText(getString(R.string.room_presence_service_description))
            .setContentIntent(openAppIntent())
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun openAppIntent(): PendingIntent = PendingIntent.getActivity(
        this,
        NOTIFICATION_ID,
        Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    private fun createServiceChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(
                SERVICE_CHANNEL_ID,
                getString(R.string.room_presence_service_notification),
                NotificationManager.IMPORTANCE_LOW
            ).apply { setSound(null, null); enableVibration(false) }
        )
    }

    private fun acquireWakeLock() {
        val manager = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$TAG:RoomPresence").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    companion object {
        private const val TAG = "HotelAlertRoomPresence"
        private const val SERVICE_CHANNEL_ID = "hotel-alert-room-presence"
        private const val NOTIFICATION_ID = 10_002
        private const val ACTION_STOP = "com.hotelalert.notificationreceiver.ROOM_PRESENCE_STOP"

        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, RoomPresenceService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, RoomPresenceService::class.java).setAction(ACTION_STOP))
        }
    }
}

class AndroidRoomPresenceServiceController(private val context: Context) :
    com.hotelalert.notificationreceiver.protocol.RoomPresenceServiceController {
    override fun start() = RoomPresenceService.start(context)

    override fun stop() = RoomPresenceService.stop(context)
}
