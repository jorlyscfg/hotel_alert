package com.hotelalert.notificationreceiver.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.hotelalert.notificationreceiver.HotelAlertApplication
import com.hotelalert.notificationreceiver.shouldRestoreRoomPresence
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class RoomPresenceRestoreReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val application = context.applicationContext as? HotelAlertApplication ?: return
        val pendingResult = goAsync()

        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                val hasRoomSession = application.component.hasConfiguredRoomPresenceSession()
                if (shouldRestoreRoomPresence(action, hasRoomSession)) {
                    RoomPresenceService.start(application)
                }
            } catch (error: Exception) {
                Log.w(TAG, "ROOM presence could not be restored after a system event.", error)
            } finally {
                pendingResult.finish()
            }
        }
    }

    private companion object {
        const val TAG = "HotelAlertRoomRestore"
    }
}
