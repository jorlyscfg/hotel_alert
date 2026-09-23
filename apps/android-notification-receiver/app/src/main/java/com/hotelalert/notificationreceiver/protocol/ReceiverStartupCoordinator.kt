package com.hotelalert.notificationreceiver.protocol

import com.hotelalert.notificationreceiver.storage.DeviceTokenStore
import kotlinx.coroutines.CancellationException

class ReceiverStartupCoordinator(
    private val configurationStore: ReceiverConfigurationStore,
    private val tokenStore: DeviceTokenStore
) {
    suspend fun shouldStartReceiver(): Boolean {
        val runIntent = configurationStore.readReceiverRunIntent()
        if (runIntent == false) return false

        val configuration = configurationStore.read()
        if (configuration == null || configuration.deviceId.isBlank() || configuration.serverOrigin.isBlank()) {
            configurationStore.writeReceiverRunIntent(false)
            return false
        }

        val token = try {
            tokenStore.read()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            return false
        }
        if (token.isNullOrBlank()) {
            configurationStore.writeReceiverRunIntent(false)
            return false
        }

        if (runIntent == null) configurationStore.writeReceiverRunIntent(true)
        return true
    }
}
