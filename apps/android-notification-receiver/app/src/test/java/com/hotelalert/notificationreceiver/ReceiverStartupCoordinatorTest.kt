package com.hotelalert.notificationreceiver

import com.hotelalert.notificationreceiver.protocol.ReceiverConfiguration
import com.hotelalert.notificationreceiver.protocol.ReceiverConfigurationStore
import com.hotelalert.notificationreceiver.protocol.ReceiverStartupCoordinator
import com.hotelalert.notificationreceiver.protocol.PairingStateRollback
import com.hotelalert.notificationreceiver.storage.AndroidPairingStateStore
import com.hotelalert.notificationreceiver.storage.DeviceTokenStore
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class ReceiverStartupCoordinatorTest {
    @Test
    fun `migrates a legacy pairing without requiring a cached snapshot`() = runTest {
        val configurationStore = MutableConfigurationStore(configuration(), runIntent = null)
        val coordinator = ReceiverStartupCoordinator(configurationStore, FixedTokenStore("keystore-token"))

        assertTrue(coordinator.shouldStartReceiver())
        assertEquals(true, configurationStore.runIntent)
    }

    @Test
    fun `an explicit stop remains disabled even when pairing credentials remain`() = runTest {
        val configurationStore = MutableConfigurationStore(configuration(), runIntent = false)
        val tokenStore = FixedTokenStore("keystore-token")
        val coordinator = ReceiverStartupCoordinator(configurationStore, tokenStore)

        assertFalse(coordinator.shouldStartReceiver())
        assertEquals(false, configurationStore.runIntent)
        assertEquals(0, tokenStore.readCount)
    }

    @Test
    fun `missing assignment keeps startup disabled`() = runTest {
        val configurationStore = MutableConfigurationStore(null, runIntent = null)
        val coordinator = ReceiverStartupCoordinator(configurationStore, FixedTokenStore("keystore-token"))

        assertFalse(coordinator.shouldStartReceiver())
        assertEquals(false, configurationStore.runIntent)
    }

    @Test
    fun `missing protected token keeps startup disabled`() = runTest {
        val configurationStore = MutableConfigurationStore(configuration(), runIntent = true)
        val coordinator = ReceiverStartupCoordinator(configurationStore, FixedTokenStore(null))

        assertFalse(coordinator.shouldStartReceiver())
        assertEquals(false, configurationStore.runIntent)
    }

    @Test
    fun `enabled intent starts when assignment and protected token remain available`() = runTest {
        val configurationStore = MutableConfigurationStore(configuration(), runIntent = true)
        val coordinator = ReceiverStartupCoordinator(configurationStore, FixedTokenStore("keystore-token"))

        assertTrue(coordinator.shouldStartReceiver())
        assertEquals(true, configurationStore.runIntent)
    }

    @Test
    fun `a temporary token-store failure does not migrate or disable intent`() = runTest {
        val configurationStore = MutableConfigurationStore(configuration(), runIntent = null)
        val coordinator = ReceiverStartupCoordinator(configurationStore, FixedTokenStore(null, IllegalStateException("keystore locked")))

        assertFalse(coordinator.shouldStartReceiver())
        assertEquals(null, configurationStore.runIntent)
    }

    @Test
    fun `pairing rollback restores the previous explicit Stop state`() = runTest {
        val previousConfiguration = configuration()
        val configurationStore = MutableConfigurationStore(previousConfiguration, runIntent = false)
        val tokenStore = FixedTokenStore("previous-token")
        val pairingStateStore = AndroidPairingStateStore(configurationStore, tokenStore)
        val rollback: PairingStateRollback = pairingStateStore.replace(
            previousConfiguration.copy(deviceId = "device-2"),
            "replacement-token"
        )
        configurationStore.writeReceiverRunIntent(true)

        rollback.restore()

        assertEquals(previousConfiguration, configurationStore.read())
        assertEquals("previous-token", tokenStore.token)
        assertEquals(false, configurationStore.runIntent)
    }

    private fun configuration() = ReceiverConfiguration(
        serverOrigin = "https://hotel.test",
        deviceId = "device-1",
        clientInstanceId = "client-1",
        clientVersion = "0.1.0"
    )

    private class MutableConfigurationStore(
        private var configuration: ReceiverConfiguration?,
        var runIntent: Boolean?
    ) : ReceiverConfigurationStore {
        override fun read(): ReceiverConfiguration? = configuration

        override fun write(configuration: ReceiverConfiguration) {
            this.configuration = configuration
        }

        override fun readReceiverRunIntent(): Boolean? = runIntent

        override fun writeReceiverRunIntent(enabled: Boolean) {
            runIntent = enabled
        }

        override fun clearReceiverRunIntent() {
            runIntent = null
        }
    }

    private class FixedTokenStore(
        var token: String?,
        private val readError: Exception? = null
    ) : DeviceTokenStore {
        var readCount = 0
            private set

        override suspend fun read(): String? {
            readCount += 1
            readError?.let { throw it }
            return token
        }

        override suspend fun write(token: String) {
            this.token = token
        }

        override suspend fun clear() = Unit
    }
}
